import React, { useEffect, useState } from 'react';

interface DataChartProps {
  endpoint: string;
}

interface ChartData {
  labels: string[];
  values: number[];
}

export function DataChart({ endpoint }: DataChartProps) {
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(endpoint)
      .then((res) => res.json())
      .then((data) => {
        setData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [endpoint]);

  if (loading) {
    return <div className="p-4 bg-bg-elevated rounded shadow-lg">Loading chart...</div>;
  }

  if (error) {
    return (
      <div className="p-4 bg-error-muted text-error rounded border border-error">
        Error loading chart: {error}
      </div>
    );
  }

  if (!data) {
    return <div className="p-4 bg-bg-elevated rounded shadow-lg">No data available</div>;
  }

  const maxValue = Math.max(...data.values);

  return (
    <div className="p-4 bg-bg-elevated rounded shadow-lg">
      <h3 className="text-lg font-semibold mb-4">Data Visualization</h3>
      <div className="space-y-2">
        {data.labels.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-16 text-sm text-text-secondary font-mono">{label}</div>
            <div className="flex-1 bg-bg-surface rounded h-8 relative">
              <div
                className="bg-primary h-full rounded flex items-center justify-end pr-2 text-bg-base font-medium text-sm transition-all shadow-glow-subtle"
                style={{ width: `${(data.values[i] / maxValue) * 100}%` }}
              >
                {data.values[i]}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
