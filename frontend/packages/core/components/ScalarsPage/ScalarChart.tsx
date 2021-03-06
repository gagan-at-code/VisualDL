import {
    Dataset,
    Range,
    RangeParams,
    TransformParams,
    chartData,
    range,
    singlePointRange,
    sortingMethodMap,
    tooltip,
    transform,
    xAxisMap
} from '~/resource/scalars';
import React, {FunctionComponent, useCallback, useMemo} from 'react';
import {em, size} from '~/utils/style';

import {EChartOption} from 'echarts';
import LineChart from '~/components/LineChart';
import {cycleFetcher} from '~/utils/fetch';
import queryString from 'query-string';
import styled from 'styled-components';
import useHeavyWork from '~/hooks/useHeavyWork';
import {useRunningRequest} from '~/hooks/useRequest';
import {useTranslation} from '~/utils/i18n';

const width = em(430);
const height = em(320);

const smoothWasm = () =>
    import('@visualdl/wasm').then(({transform}) => (params: TransformParams) =>
        (transform(params.datasets, params.smoothing) as unknown) as Dataset[]
    );
const rangeWasm = () =>
    import('@visualdl/wasm').then(({range}) => (params: RangeParams) =>
        (range(params.datasets, params.outlier) as unknown) as Range
    );

const smoothWorker = () => new Worker('~/worker/scalars/smooth.worker.ts', {type: 'module'});
const rangeWorker = () => new Worker('~/worker/scalars/range.worker.ts', {type: 'module'});

const StyledLineChart = styled(LineChart)`
    ${size(height, width)}
`;

const Error = styled.div`
    ${size(height, width)}
    display: flex;
    justify-content: center;
    align-items: center;
`;

type ScalarChartProps = {
    runs: string[];
    tag: string;
    smoothing: number;
    xAxis: keyof typeof xAxisMap;
    sortingMethod: keyof typeof sortingMethodMap;
    outlier?: boolean;
    running?: boolean;
};

const ScalarChart: FunctionComponent<ScalarChartProps> = ({
    runs,
    tag,
    smoothing,
    xAxis,
    sortingMethod,
    outlier,
    running
}) => {
    const {t, i18n} = useTranslation(['scalars', 'common']);

    const {data: datasets, error, loading} = useRunningRequest<(Dataset | null)[]>(
        runs.map(run => `/scalars/list?${queryString.stringify({run, tag})}`),
        !!running,
        (...urls) => cycleFetcher(urls)
    );

    const smooth = false;
    const type = useMemo(() => (xAxis === 'wall' ? 'time' : 'value'), [xAxis]);
    const xAxisLabel = useMemo(() => (xAxis === 'step' ? '' : t(`x-axis-value.${xAxis}`)), [xAxis, t]);

    const transformParams = useMemo(
        () => ({
            datasets: datasets?.map(data => data ?? []) ?? [],
            smoothing
        }),
        [datasets, smoothing]
    );
    const smoothedDatasets = useHeavyWork(smoothWasm, smoothWorker, transform, transformParams) ?? [];

    const rangeParams = useMemo(
        () => ({
            datasets: smoothedDatasets,
            outlier: !!outlier
        }),
        [smoothedDatasets, outlier]
    );
    const yRange = useHeavyWork(rangeWasm, rangeWorker, range, rangeParams);

    const ranges: Record<'x' | 'y', Range | undefined> = useMemo(() => {
        let x: Range | undefined = undefined;
        let y: Range | undefined = yRange;

        // if there is only one point, place it in the middle
        if (smoothedDatasets.length === 1 && smoothedDatasets[0].length === 1) {
            if (['value', 'log'].includes(type)) {
                x = singlePointRange(smoothedDatasets[0][0][xAxisMap[xAxis]]);
            }
            y = singlePointRange(smoothedDatasets[0][0][2]);
        }
        return {x, y};
    }, [smoothedDatasets, yRange, type, xAxis]);

    const data = useMemo(
        () =>
            chartData({
                data: smoothedDatasets,
                runs,
                smooth,
                xAxis
            }),
        [smoothedDatasets, runs, smooth, xAxis]
    );

    const formatter = useCallback(
        (params: EChartOption.Tooltip.Format | EChartOption.Tooltip.Format[]) => {
            const data = Array.isArray(params) ? params[0].data : params.data;
            const step = data[1];
            const points =
                smoothedDatasets?.map((series, index) => {
                    let nearestItem;
                    if (step === 0) {
                        nearestItem = series[0];
                    } else {
                        for (let i = 0; i < series.length; i++) {
                            const item = series[i];
                            if (item[1] === step) {
                                nearestItem = item;
                                break;
                            }
                            if (item[1] > step) {
                                nearestItem = series[i - 1 >= 0 ? i - 1 : 0];
                                break;
                            }
                            if (!nearestItem) {
                                nearestItem = series[series.length - 1];
                            }
                        }
                    }
                    return {
                        run: runs[index],
                        item: nearestItem || []
                    };
                }) ?? [];
            const sort = sortingMethodMap[sortingMethod];
            return tooltip(sort ? sort(points, data) : points, i18n);
        },
        [smoothedDatasets, runs, sortingMethod, i18n]
    );

    // display error only on first fetch
    if (!data && error) {
        return <Error>{t('common:error')}</Error>;
    }

    return (
        <StyledLineChart
            title={tag}
            xAxis={xAxisLabel}
            xRange={ranges.x}
            yRange={ranges.y}
            type={type}
            tooltip={formatter}
            data={data}
            loading={loading}
        />
    );
};

export default ScalarChart;
