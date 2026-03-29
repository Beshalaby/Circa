import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { format } from 'date-fns';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import './PredictionPage.css';

type ClusterId = 'cluster_1' | 'cluster_2' | 'cluster_3';
type PredictionView = 'graph' | 'timeline';

interface ClusterMeta {
  id: ClusterId;
  label: string;
  zone: string;
  station: string;
  cropType: string;
}

interface PredictionPoint {
  timestamp: string;
  value: number | null;
  rawMoisture: number | null;
  predicted: boolean;
  humidity: number | null;
  temperature: number | null;
  rainFlag: boolean | null;
  online: boolean;
  confidence: number | null;
}

interface ClusterNodeSeries {
  id: string;
  label: string;
  color: string;
  points: PredictionPoint[];
}

interface ClusterChartPoint {
  timestamp: string;
  predicted: boolean;
  [key: string]: string | number | boolean | null;
}

interface TimelinePoint {
  timestamp: string;
  predicted: boolean;
  avgValue: number | null;
}

interface NodeSnapshot {
  id: string;
  label: string;
  color: string;
  point: PredictionPoint;
  visible: boolean;
}

interface PredictorPredictionOut {
  cluster_id: ClusterId;
  crop: string;
  timestamp: string;
  predicted_vwc_tomorrow: number | null;
  current_vwc: number | null;
  time_to_critical_days: number | null;
  critical_threshold: number;
  confidence: number;
  irrigation_recommended: boolean;
  top_drivers: Record<string, number>;
  model_version: string;
  fallback_used: boolean;
}

interface PredictorAllPredictionsOut {
  predictions: PredictorPredictionOut[];
  fetched_at: string;
}

interface PredictorSensorReadingOut {
  id: string;
  timestamp: string;
  cluster_id: ClusterId;
  node_id: string;
  base_station_id: string | null;
  vwc: number | null;
  rh: number | null;
  t_air: number | null;
  rain_flag: boolean;
}

interface PredictorLatestReadingsByCluster {
  cluster_id: ClusterId;
  nodes: PredictorSensorReadingOut[];
  last_updated: string | null;
}

const CLUSTERS: ClusterMeta[] = [
  {
    id: 'cluster_1',
    label: 'Cluster 1',
    zone: 'North Terrace',
    station: 'Base-01',
    cropType: 'Wheat',
  },
  {
    id: 'cluster_2',
    label: 'Cluster 2',
    zone: 'East Field',
    station: 'Base-02',
    cropType: 'Tomato',
  },
  {
    id: 'cluster_3',
    label: 'Cluster 3',
    zone: 'South Orchard',
    station: 'Base-03',
    cropType: 'Cotton',
  },
];

const NODE_COLORS = ['#0f0e0c', '#8b6914', '#2d7a4f', '#1d6a94', '#c2410c', '#b91c1c'];
const HOUR_MS = 60 * 60 * 1000;
const OBSERVED_COUNT = 28;
const STEP_HOURS = 3;
const FORECAST_HOURS = 24;
const POLL_INTERVAL_MS = 30_000;
const PREDICTOR_BASE_URL = (import.meta.env.VITE_PREDICTOR_URL || 'http://localhost:8000').replace(/\/+$/, '');

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, places = 1) {
  const p = 10 ** places;
  return Math.round(value * p) / p;
}

function toMillis(timestamp: string) {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatTime(ts: string) {
  return format(new Date(ts), 'MMM d, HH:mm');
}

function formatNodeLabel(nodeId: string) {
  return nodeId
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function colorForNode(nodeId: string, index: number) {
  let hash = 0;
  for (const ch of nodeId) {
    hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  }
  const paletteIndex = Math.abs(hash || index) % NODE_COLORS.length;
  return NODE_COLORS[paletteIndex];
}

function average(values: Array<number | null | undefined>, places = 1): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number');
  if (!numbers.length) return null;
  const total = numbers.reduce((sum, value) => sum + value, 0);
  return round(total / numbers.length, places);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    let detail = '';
    try {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const payload = await response.json() as { detail?: unknown };
        if (typeof payload.detail === 'string') {
          detail = payload.detail;
        } else if (payload.detail !== undefined) {
          detail = JSON.stringify(payload.detail);
        }
      } else {
        detail = (await response.text()).trim();
      }
    } catch {
      // Keep base error when response parsing fails.
    }

    throw new Error(
      `Request failed (${response.status}) for ${url}${detail ? `: ${detail}` : ''}`,
    );
  }
  return (await response.json()) as T;
}

async function fetchPredictionForCluster(clusterId: ClusterId): Promise<PredictorPredictionOut> {
  try {
    const all = await fetchJson<PredictorAllPredictionsOut>(
      `${PREDICTOR_BASE_URL}/api/v1/predictions/all`,
    );
    const fromAll = all.predictions.find((row) => row.cluster_id === clusterId);
    if (fromAll) {
      return fromAll;
    }
  } catch {
    // Fallback to single-cluster endpoint for older/backward-incompatible backends.
  }

  return fetchJson<PredictorPredictionOut>(
    `${PREDICTOR_BASE_URL}/api/v1/predictions/${clusterId}`,
  );
}

async function fetchClusterBundle(clusterId: ClusterId): Promise<{
  prediction: PredictorPredictionOut;
  history: PredictorSensorReadingOut[];
  latestForCluster: PredictorSensorReadingOut[];
}> {
  const now = new Date();
  const start = new Date(now.getTime() - OBSERVED_COUNT * STEP_HOURS * HOUR_MS * 2);

  const historyParams = new URLSearchParams({
    cluster_id: clusterId,
    start: start.toISOString(),
    end: now.toISOString(),
    limit: '10000',
  });

  const [predictionRes, historyRes, latestRes] = await Promise.allSettled([
    fetchPredictionForCluster(clusterId),
    fetchJson<PredictorSensorReadingOut[]>(`${PREDICTOR_BASE_URL}/api/v1/sensors/history?${historyParams.toString()}`),
    fetchJson<PredictorLatestReadingsByCluster[]>(`${PREDICTOR_BASE_URL}/api/v1/sensors/latest`),
  ]);

  if (predictionRes.status === 'rejected') {
    throw predictionRes.reason;
  }

  const prediction = predictionRes.value;
  const history = historyRes.status === 'fulfilled' ? historyRes.value : [];
  const latestByCluster = latestRes.status === 'fulfilled' ? latestRes.value : [];

  const latestForCluster = latestByCluster.find((row) => row.cluster_id === clusterId)?.nodes ?? [];

  return {
    prediction,
    history,
    latestForCluster,
  };
}

function buildSeriesFromBackend(
  historyRows: PredictorSensorReadingOut[],
  latestRows: PredictorSensorReadingOut[],
  prediction: PredictorPredictionOut | null,
): ClusterNodeSeries[] {
  const allRows = [...historyRows, ...latestRows];
  const nodeIds = Array.from(new Set(allRows.map((row) => row.node_id))).sort();
  if (!nodeIds.length) return [];

  const anchorMs = allRows.reduce((max, row) => {
    const ts = toMillis(row.timestamp);
    return Number.isFinite(ts) ? Math.max(max, ts) : max;
  }, Date.now());

  const observedStartMs = anchorMs - (OBSERVED_COUNT - 1) * STEP_HOURS * HOUR_MS;
  const observedTimeline = Array.from({ length: OBSERVED_COUNT }, (_, idx) => (
    new Date(observedStartMs + idx * STEP_HOURS * HOUR_MS).toISOString()
  ));

  const rowsByNode = new Map<string, PredictorSensorReadingOut[]>();
  for (const nodeId of nodeIds) rowsByNode.set(nodeId, []);
  for (const row of allRows) {
    rowsByNode.get(row.node_id)?.push(row);
  }
  for (const rows of rowsByNode.values()) {
    rows.sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp));
  }

  const observedByNode = new Map<string, PredictionPoint[]>();
  const latestObservedByNode = new Map<string, PredictionPoint | null>();

  for (const nodeId of nodeIds) {
    const rows = rowsByNode.get(nodeId) ?? [];
    const points: PredictionPoint[] = [];

    let cursor = 0;
    let lastReading: PredictorSensorReadingOut | null = null;

    for (const timestamp of observedTimeline) {
      const bucketMs = toMillis(timestamp);

      while (cursor < rows.length) {
        const rowTs = toMillis(rows[cursor].timestamp);
        if (!Number.isFinite(rowTs) || rowTs > bucketMs) break;
        lastReading = rows[cursor];
        cursor += 1;
      }

      const lastTs = lastReading ? toMillis(lastReading.timestamp) : Number.NaN;
      const hasValue = Boolean(
        lastReading &&
        Number.isFinite(lastTs) &&
        lastTs >= observedStartMs,
      );

      points.push({
        timestamp,
        value: hasValue && typeof lastReading?.vwc === 'number' ? round(lastReading.vwc, 1) : null,
        rawMoisture: null,
        predicted: false,
        humidity: hasValue && typeof lastReading?.rh === 'number' ? round(lastReading.rh, 1) : null,
        temperature: hasValue && typeof lastReading?.t_air === 'number' ? round(lastReading.t_air, 1) : null,
        rainFlag: hasValue && typeof lastReading?.rain_flag === 'boolean' ? lastReading.rain_flag : null,
        online: hasValue && Number.isFinite(lastTs) ? (bucketMs - lastTs <= STEP_HOURS * HOUR_MS * 2) : false,
        confidence: null,
      });
    }

    observedByNode.set(nodeId, points);
    latestObservedByNode.set(
      nodeId,
      [...points].reverse().find((point) => point.value !== null) ?? null,
    );
  }

  const clusterPredictionValue = typeof prediction?.predicted_vwc_tomorrow === 'number'
    ? round(clamp(prediction.predicted_vwc_tomorrow, 0, 100), 1)
    : null;
  const predictionConfidencePct = prediction
    ? round(clamp(prediction.confidence * 100, 0, 100), 1)
    : null;
  const latestClusterAverage = average(
    Array.from(latestObservedByNode.values()).map((point) => point?.value),
    2,
  );
  const forecastTimestamp = new Date(anchorMs + FORECAST_HOURS * HOUR_MS).toISOString();

  return nodeIds.map((nodeId, index) => {
    const observedPoints = observedByNode.get(nodeId) ?? [];
    const latestObservedPoint = latestObservedByNode.get(nodeId) ?? null;

    let forecastValue: number | null = null;
    if (
      clusterPredictionValue !== null &&
      latestObservedPoint !== null &&
      latestObservedPoint.value !== null &&
      latestClusterAverage !== null
    ) {
      const nodeOffset = latestObservedPoint.value - latestClusterAverage;
      forecastValue = round(clamp(clusterPredictionValue + nodeOffset, 0, 100), 1);
    } else if (clusterPredictionValue !== null) {
      forecastValue = clusterPredictionValue;
    }

    const predictedPoint: PredictionPoint = {
      timestamp: forecastTimestamp,
      value: forecastValue,
      rawMoisture: null,
      predicted: true,
      humidity: latestObservedPoint?.humidity ?? null,
      temperature: latestObservedPoint?.temperature ?? null,
      rainFlag: latestObservedPoint?.rainFlag ?? null,
      online: false,
      confidence: predictionConfidencePct,
    };

    return {
      id: nodeId,
      label: formatNodeLabel(nodeId),
      color: colorForNode(nodeId, index),
      points: [...observedPoints, predictedPoint],
    };
  });
}

function emptyPoint(timestamp: string): PredictionPoint {
  return {
    timestamp,
    value: null,
    rawMoisture: null,
    predicted: false,
    humidity: null,
    temperature: null,
    rainFlag: null,
    online: false,
    confidence: null,
  };
}

export default function PredictionPage() {
  const [activeCluster, setActiveCluster] = useState<ClusterId>('cluster_1');
  const [view, setView] = useState<PredictionView>('graph');
  const [clusterNodes, setClusterNodes] = useState<ClusterNodeSeries[]>([]);
  const [activePrediction, setActivePrediction] = useState<PredictorPredictionOut | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [visibleNodeIds, setVisibleNodeIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refreshData = async (backgroundRefresh: boolean) => {
      if (!backgroundRefresh) setLoading(true);

      try {
        const { prediction, history, latestForCluster } = await fetchClusterBundle(activeCluster);
        if (cancelled) return;

        const nextNodes = buildSeriesFromBackend(history, latestForCluster, prediction);

        setClusterNodes(nextNodes);
        setActivePrediction(prediction);
        setLoadError(null);
        setLastLoadedAt(new Date().toISOString());

        setVisibleNodeIds((prev) => {
          const allIds = nextNodes.map((node) => node.id);
          if (!allIds.length) return [];

          const preserved = prev.filter((id) => allIds.includes(id));
          return preserved.length ? preserved : allIds;
        });

        setSelectedIndex((prev) => {
          const maxIndex = Math.max(0, (nextNodes[0]?.points.length ?? 1) - 1);
          return Math.min(prev, maxIndex);
        });
      } catch (error) {
        if (cancelled) return;

        const details = error instanceof Error ? error.message : 'Unknown network error.';
        setLoadError(`Unable to load predictor data. ${details}`);

        if (!backgroundRefresh) {
          setClusterNodes([]);
          setActivePrediction(null);
          setVisibleNodeIds([]);
          setSelectedIndex(0);
        }
      } finally {
        if (!cancelled && !backgroundRefresh) {
          setLoading(false);
        }
      }
    };

    void refreshData(false);
    const interval = window.setInterval(() => {
      void refreshData(true);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeCluster]);

  const activeMeta = CLUSTERS.find((cluster) => cluster.id === activeCluster) ?? CLUSTERS[0];
  const activeCropType = activePrediction?.crop ?? activeMeta.cropType;
  const visibleNodes = clusterNodes.filter((node) => visibleNodeIds.includes(node.id));
  const renderedNodes = visibleNodes.length ? visibleNodes : clusterNodes;

  const chartData: ClusterChartPoint[] = useMemo(() => {
    if (!clusterNodes.length) return [];

    const predictedStartByNode = new Map(
      clusterNodes.map((node) => [node.id, node.points.findIndex((point) => point.predicted)]),
    );

    return clusterNodes[0].points.map((basePoint, idx) => {
      const row: ClusterChartPoint = {
        timestamp: basePoint.timestamp,
        predicted: basePoint.predicted,
      };

      for (const node of clusterNodes) {
        const point = node.points[idx] ?? emptyPoint(basePoint.timestamp);
        const predictedStartIdx = predictedStartByNode.get(node.id) ?? -1;
        const predictedBridgeStart = predictedStartIdx >= 0 ? Math.max(0, predictedStartIdx - 1) : -1;

        row[`${node.id}Observed`] = point.predicted ? null : point.value;
        row[`${node.id}Predicted`] = predictedBridgeStart >= 0 && idx >= predictedBridgeStart
          ? point.value
          : null;
      }

      return row;
    });
  }, [clusterNodes]);

  const timelineData: TimelinePoint[] = useMemo(() => {
    if (!renderedNodes.length) return [];

    return renderedNodes[0].points.map((point, idx) => {
      const avgValue = average(renderedNodes.map((node) => node.points[idx]?.value), 1);
      return {
        timestamp: point.timestamp,
        predicted: point.predicted,
        avgValue,
      };
    });
  }, [renderedNodes]);

  const safeSelectedIndex = Math.min(selectedIndex, Math.max(0, timelineData.length - 1));
  const selectedTimelinePoint = timelineData[safeSelectedIndex] ?? null;
  const previousTimelinePoint = timelineData[Math.max(0, safeSelectedIndex - 1)] ?? null;
  const averageDelta = (
    selectedTimelinePoint?.avgValue !== null &&
    selectedTimelinePoint?.avgValue !== undefined &&
    previousTimelinePoint?.avgValue !== null &&
    previousTimelinePoint?.avgValue !== undefined
  )
    ? round(selectedTimelinePoint.avgValue - previousTimelinePoint.avgValue, 1)
    : null;

  const baseStationMetrics = (() => {
    if (!renderedNodes.length) {
      return {
        temperature: null as number | null,
        humidity: null as number | null,
        raining: null as boolean | null,
        confidence: null as number | null,
      };
    }

    const selectedPoints = renderedNodes.map((node) => {
      const idx = Math.min(safeSelectedIndex, Math.max(0, node.points.length - 1));
      return node.points[idx] ?? emptyPoint(new Date().toISOString());
    });

    const temperature = average(selectedPoints.map((point) => point.temperature), 1);
    const humidity = average(selectedPoints.map((point) => point.humidity), 1);

    const rainFlags = selectedPoints
      .map((point) => point.rainFlag)
      .filter((value): value is boolean => typeof value === 'boolean');
    const raining = rainFlags.length ? rainFlags.some(Boolean) : null;

    const confidenceFromSeries = average(selectedPoints.map((point) => point.confidence), 1);
    const confidenceFromPrediction = activePrediction
      ? round(clamp(activePrediction.confidence * 100, 0, 100), 1)
      : null;

    return {
      temperature,
      humidity,
      raining,
      confidence: confidenceFromSeries ?? confidenceFromPrediction,
    };
  })();

  const nodeSnapshots: NodeSnapshot[] = clusterNodes.map((node) => {
    const idx = Math.min(safeSelectedIndex, Math.max(0, node.points.length - 1));
    const point = node.points[idx] ?? emptyPoint(selectedTimelinePoint?.timestamp ?? new Date().toISOString());

    return {
      id: node.id,
      label: node.label,
      color: node.color,
      point,
      visible: visibleNodeIds.includes(node.id),
    };
  });

  const observedCount = timelineData.filter((point) => !point.predicted).length;
  const forecastCount = timelineData.length - observedCount;
  const predictedStartIdx = timelineData.findIndex((point) => point.predicted);
  const predictedShadeStartIdx = predictedStartIdx >= 0 ? Math.max(0, predictedStartIdx - 1) : -1;
  const predictedShadeStartTs = predictedShadeStartIdx >= 0 ? timelineData[predictedShadeStartIdx].timestamp : null;

  const recentSlice = timelineData.slice(-16);
  const recentOffset = timelineData.length - recentSlice.length;

  const handleChartCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || chartData.length === 0) return;

    const relativeX = clamp(event.clientX - bounds.left, 0, bounds.width);
    const ratio = relativeX / bounds.width;
    const computedIdx = Math.round(ratio * (chartData.length - 1));
    setSelectedIndex(computedIdx);
  };

  const toggleNodeVisibility = (nodeId: string) => {
    setVisibleNodeIds((prev) => {
      const isVisible = prev.includes(nodeId);
      if (isVisible && prev.length === 1) return prev;
      if (isVisible) return prev.filter((id) => id !== nodeId);
      return [...prev, nodeId];
    });
  };

  const hasSeriesData = chartData.length > 0;

  return (
    <div className="prediction-page fade-in">
      <header className="prediction-topbar">
        <div>
          <span className="prediction-kicker mono">AI Forecast</span>
          <h1 className="prediction-title">Moisture Over Time</h1>
          <p className="prediction-subtitle">
            Live series from VWC-Predictor. Toggle nodes on or off to compare overlays across the selected cluster.
          </p>
          <p className={`prediction-data-status ${loadError ? 'error' : ''}`}>
            {loading
              ? 'Loading predictor data...'
              : loadError
                ? loadError
                : `Source: ${PREDICTOR_BASE_URL}${lastLoadedAt ? ` | Updated ${formatTime(lastLoadedAt)}` : ''}`}
          </p>
        </div>

        <div className="prediction-cluster-field">
          <label className="prediction-select-label mono" htmlFor="prediction-cluster-select">
            Cluster
          </label>
          <div className="prediction-select-wrap">
            <select
              id="prediction-cluster-select"
              className="prediction-cluster-select"
              value={activeCluster}
              onChange={(event) => setActiveCluster(event.target.value as ClusterId)}
            >
              {CLUSTERS.map((cluster) => (
                <option key={cluster.id} value={cluster.id}>
                  {`${cluster.label} - ${cluster.zone}`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="prediction-content">
        <section className="prediction-chart-panel" aria-label="Moisture trend chart">
          <div className="prediction-chart-head">
            <div className="prediction-chart-meta">
              <span className="prediction-chart-meta-item mono">{activeMeta.station}</span>
              <span className="prediction-chart-meta-item mono">{`${clusterNodes.length} Nodes`}</span>
              <span className="prediction-chart-meta-item mono">{activeCropType}</span>
            </div>

            <div className="prediction-chart-controls">
              {view === 'graph' && (
                <div className="prediction-legend" aria-hidden="true">
                  <span className="prediction-legend-item">
                    <span className="prediction-legend-line observed" />
                    Observed ({observedCount})
                  </span>
                  <span className="prediction-legend-item">
                    <span className="prediction-legend-line predicted" />
                    Predicted ({forecastCount})
                  </span>
                </div>
              )}

              <div className="prediction-view-toggle" role="tablist" aria-label="Prediction view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'graph'}
                  className={`prediction-view-btn ${view === 'graph' ? 'active' : ''}`}
                  onClick={() => setView('graph')}
                >
                  Graph
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'timeline'}
                  className={`prediction-view-btn ${view === 'timeline' ? 'active' : ''}`}
                  onClick={() => setView('timeline')}
                >
                  Recent Timeline
                </button>
              </div>
            </div>
          </div>

          <div className="prediction-chart-wrap">
            {!hasSeriesData ? (
              <div className="prediction-empty-state">
                {loading ? <div className="spinner" aria-hidden="true" /> : null}
                <p className="prediction-empty-state-title">No sensor series found for this cluster.</p>
                <p className="prediction-empty-state-body">
                  Ensure VWC-Predictor is running and has data for {activeMeta.label.toLowerCase()}.
                </p>
              </div>
            ) : view === 'graph' ? (
              <div className="prediction-chart-graph">
                <div className="prediction-chart-canvas" onClick={handleChartCanvasClick}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 18, left: -12, bottom: 3 }}>
                      <CartesianGrid stroke="var(--gray-100)" strokeDasharray="3 4" vertical={false} />
                      <XAxis
                        dataKey="timestamp"
                        tickFormatter={formatTime}
                        minTickGap={34}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: 'var(--gray-500)', fontSize: 11 }}
                      />
                      <YAxis
                        tickFormatter={(value) => `${value}%`}
                        tickLine={false}
                        axisLine={false}
                        width={52}
                        tick={{ fill: 'var(--gray-500)', fontSize: 11 }}
                      />

                      {predictedShadeStartTs && (
                        <ReferenceArea
                          x1={predictedShadeStartTs}
                          x2={chartData[chartData.length - 1].timestamp}
                          fill="rgba(139, 105, 20, 0.08)"
                          ifOverflow="extendDomain"
                        />
                      )}

                      {selectedTimelinePoint && (
                        <ReferenceLine
                          x={selectedTimelinePoint.timestamp}
                          stroke="var(--gray-300)"
                          strokeDasharray="4 4"
                          ifOverflow="extendDomain"
                        />
                      )}

                      <Tooltip
                        contentStyle={{
                          borderRadius: 0,
                          border: '1px solid var(--gray-200)',
                          background: 'var(--white)',
                          fontSize: 12,
                        }}
                        labelStyle={{ color: 'var(--gray-500)', fontWeight: 600, marginBottom: 6 }}
                        formatter={(value, name) => {
                          const raw = Array.isArray(value) ? value[0] : value;
                          const numeric = typeof raw === 'number' ? raw : Number(raw ?? Number.NaN);
                          return [Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : '—', String(name)];
                        }}
                        labelFormatter={(label) => format(new Date(String(label)), 'EEE, MMM d - HH:mm')}
                      />

                      {renderedNodes.map((node) => (
                        <Line
                          key={`${node.id}-observed`}
                          type="monotone"
                          dataKey={`${node.id}Observed`}
                          name={`${node.label} Observed`}
                          stroke={node.color}
                          strokeWidth={2.4}
                          dot={false}
                          activeDot={{ r: 4, fill: node.color, stroke: 'var(--white)', strokeWidth: 1 }}
                          connectNulls={false}
                        />
                      ))}

                      {renderedNodes.map((node) => (
                        <Line
                          key={`${node.id}-predicted`}
                          type="monotone"
                          dataKey={`${node.id}Predicted`}
                          name={`${node.label} Predicted`}
                          stroke={node.color}
                          strokeWidth={2.4}
                          strokeDasharray="7 5"
                          dot={false}
                          activeDot={{ r: 4, fill: node.color, stroke: 'var(--white)', strokeWidth: 1 }}
                          connectNulls={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="prediction-node-toggle-panel">
                  <div className="prediction-node-toggles" aria-label="Node line toggles">
                    {clusterNodes.map((node) => {
                      const isVisible = visibleNodeIds.includes(node.id);
                      return (
                        <button
                          key={node.id}
                          type="button"
                          className={`prediction-node-toggle ${isVisible ? 'active' : 'inactive'}`}
                          onClick={() => toggleNodeVisibility(node.id)}
                          aria-pressed={isVisible}
                        >
                          <span className="prediction-node-toggle-swatch" style={{ background: node.color }} />
                          <span className="prediction-node-toggle-label">{node.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="prediction-chart-timeline">
                <p className="prediction-chart-timeline-title mono">Recent Timeline (Visible Nodes Average)</p>
                <div className="prediction-timeline-list prediction-timeline-list--chart">
                  {recentSlice.map((point, localIdx) => {
                    const absoluteIdx = recentOffset + localIdx;
                    return (
                      <button
                        key={point.timestamp}
                        type="button"
                        className={`prediction-timeline-row ${absoluteIdx === safeSelectedIndex ? 'active' : ''}`}
                        onClick={() => setSelectedIndex(absoluteIdx)}
                      >
                        <span className="prediction-timeline-time mono">{formatTime(point.timestamp)}</span>
                        <span className={`prediction-timeline-kind ${point.predicted ? 'predicted' : 'observed'}`}>
                          {point.predicted ? 'AI' : 'Sensor'}
                        </span>
                        <span className="prediction-timeline-value mono">
                          {point.avgValue !== null ? `${point.avgValue.toFixed(1)}%` : '—'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="prediction-side-panel" aria-label="Timestamp details">
          <div className="prediction-side-head">
            <span className="prediction-side-kicker mono">Timestamp Details</span>
            <span className={`prediction-point-tag ${selectedTimelinePoint?.predicted ? 'predicted' : 'observed'}`}>
              {selectedTimelinePoint?.predicted ? 'Predicted' : 'Observed'}
            </span>
          </div>

          <div className="prediction-side-main">
            <p className="prediction-side-time">
              {selectedTimelinePoint
                ? format(new Date(selectedTimelinePoint.timestamp), 'EEE, MMM d - HH:mm')
                : 'No timestamp selected'}
            </p>
            <p className="prediction-side-vwc">
              {selectedTimelinePoint?.avgValue !== null && selectedTimelinePoint?.avgValue !== undefined
                ? `${selectedTimelinePoint.avgValue.toFixed(1)}%`
                : '—'}
            </p>
            <p className="prediction-side-vwc-label">Visible Nodes Average Moisture</p>
            <p className={`prediction-side-delta ${averageDelta === null ? 'neutral' : averageDelta >= 0 ? 'up' : 'down'}`}>
              {averageDelta === null
                ? 'No comparison available'
                : `${averageDelta >= 0 ? '+' : ''}${averageDelta.toFixed(1)}% vs previous point`}
            </p>
          </div>

          <div className="prediction-side-section">
            <p className="prediction-side-section-title mono">Base Station Signals</p>
            <div className="prediction-side-row">
              <span className="prediction-side-row-label mono">Temp</span>
              <span className="prediction-side-row-value">
                {baseStationMetrics.temperature !== null ? `${baseStationMetrics.temperature.toFixed(1)} C` : '—'}
              </span>
            </div>
            <div className="prediction-side-row">
              <span className="prediction-side-row-label mono">Humidity</span>
              <span className="prediction-side-row-value">
                {baseStationMetrics.humidity !== null ? `${baseStationMetrics.humidity.toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className="prediction-side-row">
              <span className="prediction-side-row-label mono">Rain</span>
              <span className="prediction-side-row-value">
                {baseStationMetrics.raining === null ? '—' : baseStationMetrics.raining ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="prediction-side-row">
              <span className="prediction-side-row-label mono">Crop</span>
              <span className="prediction-side-row-value">{activeCropType}</span>
            </div>
            <div className="prediction-side-row">
              <span className="prediction-side-row-label mono">Confidence</span>
              <span className="prediction-side-row-value">
                {baseStationMetrics.confidence !== null ? `${baseStationMetrics.confidence.toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className="prediction-side-row">
              <span className="prediction-side-row-label mono">Irrigation</span>
              <span className="prediction-side-row-value">
                {activePrediction
                  ? activePrediction.irrigation_recommended ? 'Recommended' : 'Not needed'
                  : '—'}
              </span>
            </div>
          </div>

          <div className="prediction-side-section prediction-side-section--cards">
            <p className="prediction-side-section-title mono">Node Moisture Sensors</p>
            <div className="prediction-node-cards">
              {nodeSnapshots.map((snapshot) => (
                <article
                  key={snapshot.id}
                  className={`prediction-node-card ${snapshot.visible ? '' : 'muted'}`}
                  aria-label={`${snapshot.label} details`}
                >
                  <div className="prediction-node-card-head">
                    <div className="prediction-node-card-title-wrap">
                      <span className="prediction-node-card-dot" style={{ background: snapshot.color }} />
                      <span className="prediction-node-card-title">{snapshot.label}</span>
                    </div>
                    <span className={`prediction-point-tag ${snapshot.point.predicted ? 'predicted' : 'observed'}`}>
                      {snapshot.point.predicted ? 'Pred' : 'Obs'}
                    </span>
                  </div>

                  <p className="prediction-node-card-percent">
                    {snapshot.point.value !== null ? `${snapshot.point.value.toFixed(1)}%` : '—'}
                  </p>
                  <p className="prediction-node-card-percent-subtext">Moisture percentage</p>

                  <div className="prediction-node-card-grid">
                    <span className="prediction-node-card-label mono">Moisture</span>
                    <span className="prediction-node-card-value">
                      {snapshot.point.rawMoisture !== null ? `${snapshot.point.rawMoisture} raw` : '—'}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
