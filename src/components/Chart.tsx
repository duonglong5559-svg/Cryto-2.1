import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, CandlestickSeries, LineSeries, IPriceLine } from 'lightweight-charts';
import { useTradingEngine } from '../store/tradingEngine';

export function Chart() {
  const { candles: data, smartTrendlines: trendlines, activeSignals: upcomingSignals, dailyPivots: currentPivot } = useTradingEngine();
  
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  
  // Custom price lines refs
  const targetLinesRef = useRef<IPriceLine[]>([]);
  const pivotLineRef = useRef<IPriceLine | null>(null);
  
  const trendlineSeriesRefs = useRef<{series: ISeriesApi<"Line">, line: any, baseColor: string}[]>([]);
  const latestCandleRef = useRef<{price: number, time: number} | null>(null);

  useEffect(() => {
    if (data.length > 0) {
      const last = data[data.length - 1];
      latestCandleRef.current = { price: last.close, time: last.time as number };
    }
  }, [data]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!latestCandleRef.current) return;
      const { price, time } = latestCandleRef.current;

      trendlineSeriesRefs.current.forEach(({ series, line, baseColor }) => {
        if (line.points.length < 2) return;
        const p1 = line.points[0];
        const p2 = line.points[1];
        const slopePerSecond = (p2.value - p1.value) / ((p2.time as number) - (p1.time as number));
        const expectedValue = p1.value + slopePerSecond * (time - (p1.time as number));
        const distance = Math.abs(price - expectedValue) / price;

        if (distance < 0.002) {
          const currentColor = series.options().color;
          series.applyOptions({
            color: currentColor === '#eab308' ? baseColor : '#eab308',
            lineWidth: 3,
          });
        } else {
          const currentColor = series.options().color;
          if (currentColor !== baseColor) {
            series.applyOptions({
              color: baseColor,
              lineWidth: 2,
            });
          }
        }
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#000000' }, // Pure black background
        textColor: '#94a3b8', // Tailwind slate-400
      },
      grid: {
        vertLines: { color: '#1e293b', style: 4 }, // Dotted lines
        horzLines: { color: '#1e293b', style: 4 },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#1e293b',
      },
      rightPriceScale: {
        borderColor: '#1e293b',
      }
    });
    
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== chartContainerRef.current) { return; }
      const newRect = entries[0].contentRect;
      chart.applyOptions({ height: newRect.height, width: newRect.width });
    });
    resizeObserver.observe(chartContainerRef.current);

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', // emerald-500
      downColor: '#ef4444', // red-500
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    seriesRef.current = candlestickSeries as unknown as ISeriesApi<"Candlestick">;

    // Trendlines will be added dynamically in the other useEffect

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      trendlineSeriesRefs.current = [];
      targetLinesRef.current = [];
      pivotLineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (seriesRef.current && data.length > 0) {
      const formattedData: CandlestickData[] = data.map(d => ({
        time: d.time as any,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));
      
      // Ensure data is strictly ascending and unique by time
      const uniqueData = Array.from(new Map(formattedData.map(item => [item.time, item])).values())
        .sort((a, b) => (a.time as number) - (b.time as number));

      try {
        const currentData = seriesRef.current.data();
        const isSameDataset = currentData.length > 0 && uniqueData.length > 0 && currentData[0].time === uniqueData[0].time;
        
        if (isSameDataset && (uniqueData.length === currentData.length || uniqueData.length === currentData.length + 1)) {
          // Update the last candle (appends if new time, updates if same time)
          seriesRef.current.update(uniqueData[uniqueData.length - 1]);
        } else {
          seriesRef.current.setData(uniqueData);
        }
      } catch (e) {
        console.error("Error setting chart data", e);
      }
    }
  }, [data]);

  useEffect(() => {
    if (chartRef.current) {
      try {
        // Remove old trendlines
        trendlineSeriesRefs.current.forEach(({ series }) => {
          chartRef.current?.removeSeries(series as any);
        });
        trendlineSeriesRefs.current = [];

        // Add new trendlines
        trendlines.lines.forEach(line => {
          const isUpper = line.type === 'upper';
          const isCurrentTF = !line.timeframe; // If no timeframe specified, assume current
          
          // Current timeframe: solid, bright. Other timeframes: dashed, slightly transparent
          const baseColor = isCurrentTF ? '#9ca3af' : 'rgba(156, 163, 175, 0.5)';
            
          const lineWidth = isCurrentTF ? 2 : 1;
          const lineStyle = isCurrentTF ? 0 : 2; // 0 = Solid, 2 = Dashed
          
          const series = chartRef.current!.addSeries(LineSeries, { 
            color: baseColor,
            lineWidth: lineWidth, 
            lineStyle: lineStyle, 
            crosshairMarkerVisible: false,
            lastValueVisible: false,
            priceLineVisible: false,
          }) as unknown as ISeriesApi<"Line">;
          
          if (line.points.length > 0) {
            const validPoints = line.points
              .filter(p => p.time != null && !isNaN(p.time as number) && p.value != null && !isNaN(p.value))
              .map(p => ({ time: p.time as any, value: p.value }))
              .sort((a, b) => (a.time as number) - (b.time as number));
              
            // Remove duplicates
            const uniquePoints = [];
            for (let i = 0; i < validPoints.length; i++) {
              if (i === 0 || validPoints[i].time !== validPoints[i-1].time) {
                uniquePoints.push(validPoints[i]);
              }
            }

            if (uniquePoints.length > 0) {
              series.setData(uniquePoints);
            }
          }
          trendlineSeriesRefs.current.push({ series, line, baseColor });
        });
      } catch (e) {
        console.error("Error setting trendlines", e);
      }
    }
  }, [trendlines]);

  useEffect(() => {
    if (seriesRef.current && data.length > 0) {
      // Remove old signal lines
      targetLinesRef.current.forEach(line => {
        try { seriesRef.current?.removePriceLine(line); } catch(e) {}
      });
      targetLinesRef.current = [];

      const lastCandleIndex = data.length - 1;
      const currentPrice = data[lastCandleIndex].close;

      let bestUpperProjected = Infinity;
      let bestLowerProjected = -Infinity;

      trendlines.lines.forEach(line => {
        if (line.points.length > 0) {
          const projectedValue = line.p1Value + line.slope * (lastCandleIndex - line.p1Index);

          if (line.type === 'upper') {
            // Find the closest upper trendline that is ABOVE the current price
            if (projectedValue > currentPrice && projectedValue < bestUpperProjected) {
              bestUpperProjected = projectedValue;
            }
          } else if (line.type === 'lower') {
            // Find the closest lower trendline that is BELOW the current price
            if (projectedValue < currentPrice && projectedValue > bestLowerProjected) {
              bestLowerProjected = projectedValue;
            }
          }
        }
      });

      if (bestUpperProjected !== Infinity) {
        try {
          const line = seriesRef.current!.createPriceLine({
            price: bestUpperProjected,
            color: '#ef4444',
            lineWidth: 2,
            lineStyle: 2, // dashed
            axisLabelVisible: true,
            title: `Đặt Lệnh Chờ Tự Động Short`,
          });
          targetLinesRef.current.push(line);
        } catch(e) {}
      }

      if (bestLowerProjected !== -Infinity) {
        try {
          const line = seriesRef.current!.createPriceLine({
            price: bestLowerProjected,
            color: '#10b981',
            lineWidth: 2,
            lineStyle: 2, // dashed
            axisLabelVisible: true,
            title: `Đặt Lệnh Chờ Tự Động Long`,
          });
          targetLinesRef.current.push(line);
        } catch(e) {}
      }
    }
  }, [trendlines, data]);

  useEffect(() => {
    if (seriesRef.current && data.length > 0 && currentPivot) {
      const currentPrice = data[data.length - 1].close;
      
      // Find nearest pivot
      const levels = [
        { name: 'S3', value: currentPivot.s3 },
        { name: 'S2', value: currentPivot.s2 },
        { name: 'S1', value: currentPivot.s1 },
        { name: 'P', value: currentPivot.p },
        { name: 'R1', value: currentPivot.r1 },
        { name: 'R2', value: currentPivot.r2 },
        { name: 'R3', value: currentPivot.r3 },
      ];
      
      let nearest = levels[0];
      let minDiff = Math.abs(currentPrice - levels[0].value);
      
      for (const level of levels) {
        const diff = Math.abs(currentPrice - level.value);
        if (diff < minDiff) {
          minDiff = diff;
          nearest = level;
        }
      }
      
      if (pivotLineRef.current) {
        try {
          pivotLineRef.current.applyOptions({
            price: nearest.value,
            title: `Giá Thị Trường Sẽ Hướng Tới`,
            lineStyle: 0, // solid
          });
        } catch(e) {}
      } else {
        try {
          pivotLineRef.current = seriesRef.current.createPriceLine({
            price: nearest.value,
            color: '#eab308', // yellow-500
            lineWidth: 1,
            lineStyle: 0, // solid
            axisLabelVisible: true,
            title: `Giá Thị Trường Sẽ Hướng Tới`,
          });
        } catch(e) {}
      }
    } else if (seriesRef.current && !currentPivot && pivotLineRef.current) {
      try { seriesRef.current.removePriceLine(pivotLineRef.current); } catch(e) {}
      pivotLineRef.current = null;
    }
  }, [currentPivot, data]);

  return <div ref={chartContainerRef} className="w-full h-full" />;
}
