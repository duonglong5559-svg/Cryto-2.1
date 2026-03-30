import { TimeframePivot } from './binance';

export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export interface Point {
  time: number;
  value: number;
  index: number;
}

export interface ChartPoint {
  time: number;
  value: number;
}

export interface SRLevel {
  price: number;
  type: 'SUPPORT' | 'RESISTANCE';
  touches: number;
  strength: number; // 0-100
  distancePct: number;
}

export function detectSRLevels(candles: Candle[], currentPrice: number, window: number = 15): SRLevel[] {
  if (candles.length < window * 2) return [];
  
  const highs: number[] = [];
  const lows: number[] = [];
  
  // Find local extrema
  for (let i = window; i < candles.length - window; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (i === j) continue;
      if (candles[j].high > candles[i].high) isHigh = false;
      if (candles[j].low < candles[i].low) isLow = false;
    }
    if (isHigh) highs.push(candles[i].high);
    if (isLow) lows.push(candles[i].low);
  }
  
  // Group close levels
  const groupLevels = (levels: number[], type: 'SUPPORT' | 'RESISTANCE'): SRLevel[] => {
    const grouped: SRLevel[] = [];
    const threshold = currentPrice * 0.003; // 0.3% grouping threshold
    
    for (const level of levels) {
      let found = false;
      for (const g of grouped) {
        if (Math.abs(g.price - level) < threshold) {
          g.price = (g.price * g.touches + level) / (g.touches + 1); // Average price
          g.touches += 1;
          g.strength = Math.min(99, g.touches * 15 + 50); // Simple strength calculation
          found = true;
          break;
        }
      }
      if (!found) {
        grouped.push({ 
          price: level, 
          type, 
          touches: 1, 
          strength: 60,
          distancePct: 0
        });
      }
    }
    
    // Calculate distance and filter
    return grouped.map(g => ({
      ...g,
      distancePct: Math.abs(g.price - currentPrice) / currentPrice * 100
    })).filter(g => g.touches > 1 || g.distancePct < 2); // Keep significant or close levels
  };
  
  const resistance = groupLevels(highs, 'RESISTANCE').filter(r => r.price > currentPrice);
  const support = groupLevels(lows, 'SUPPORT').filter(s => s.price < currentPrice);
  
  return [...resistance, ...support].sort((a, b) => a.distancePct - b.distancePct);
}

// Hàm tìm đỉnh/đáy linh hoạt với window động
function findSwingPoints(candles: Candle[], window: number, type: 'high' | 'low'): Point[] {
  const points: Point[] = [];
  for (let i = window; i < candles.length - window; i++) {
    let isSwing = true;
    const currentVal = type === 'high' ? candles[i].high : candles[i].low;
    
    for (let j = 1; j <= window; j++) {
      const leftVal = type === 'high' ? candles[i - j].high : candles[i - j].low;
      const rightVal = type === 'high' ? candles[i + j].high : candles[i + j].low;
      
      if (type === 'high' && (leftVal >= currentVal || rightVal >= currentVal)) isSwing = false;
      if (type === 'low' && (leftVal <= currentVal || rightVal <= currentVal)) isSwing = false;
    }
    
    if (isSwing) points.push({ time: candles[i].time, value: currentVal, index: i });
  }
  return points;
}

export function calculateSmartTrendlines(candles: Candle[]) {
  if (candles.length < 20) return { lines: [] };

  // Cửa sổ tìm đỉnh/đáy linh hoạt: Tối thiểu 3, tối đa tuỳ thuộc lượng data
  const window = Math.max(3, Math.floor(candles.length / 40)); 
  const swingHighs = findSwingPoints(candles, window, 'high');
  const swingLows = findSwingPoints(candles, window, 'low');
  
  const validLines: { type: 'upper' | 'lower', points: Point[], slope: number, touches: number }[] = [];

  // Lọc Trendline Cản Trên (Resistance)
  for (let i = 0; i < swingHighs.length - 1; i++) {
    for (let j = i + 1; j < swingHighs.length; j++) {
      const p1 = swingHighs[i];
      const p2 = swingHighs[j];
      const slope = (p2.value - p1.value) / (p2.index - p1.index);
      
      // Loại bỏ đường quá dốc (hơn 0.5% mỗi nến)
      if (Math.abs(slope) > (p1.value * 0.005)) continue; 

      let isValid = true;
      let touches = 2; // Đã có sẵn 2 điểm nối

      // Kiểm tra các nến sau p2 xem có phá vỡ hay test lại trendline không
      for (let k = p2.index + 1; k < candles.length; k++) {
        const expectedValue = p1.value + slope * (k - p1.index);
        
        // HỦY BỎ: Nếu giá đóng cửa vượt qua cản trên -> Breakout, đường này vứt!
        if (candles[k].close > expectedValue) {
          isValid = false;
          break;
        }

        // CỘNG ĐIỂM CHẠM: Nếu râu nến (high) chạm gần cản (sai số 0.1%)
        if (Math.abs(candles[k].high - expectedValue) / expectedValue < 0.001) {
          touches++;
        }
      }

      if (isValid) validLines.push({ type: 'upper', points: [p1, p2], slope, touches });
    }
  }

  // Lọc Trendline Cản Dưới (Support)
  for (let i = 0; i < swingLows.length - 1; i++) {
    for (let j = i + 1; j < swingLows.length; j++) {
      const p1 = swingLows[i];
      const p2 = swingLows[j];
      const slope = (p2.value - p1.value) / (p2.index - p1.index);
      
      if (Math.abs(slope) > (p1.value * 0.005)) continue;

      let isValid = true;
      let touches = 2;

      for (let k = p2.index + 1; k < candles.length; k++) {
        const expectedValue = p1.value + slope * (k - p1.index);
        
        // HỦY BỎ: Nếu giá đóng cửa xuyên thủng cản dưới
        if (candles[k].close < expectedValue) {
          isValid = false;
          break;
        }

        if (Math.abs(candles[k].low - expectedValue) / expectedValue < 0.001) {
          touches++;
        }
      }

      if (isValid) validLines.push({ type: 'lower', points: [p1, p2], slope, touches });
    }
  }

  // Chọn ra những đường xịn nhất: Ưu tiên nhiều điểm chạm nhất và gần thời điểm hiện tại nhất
  const filteredLines = validLines.filter(line => {
    const p1 = line.points[0];
    const lastIndex = candles.length - 1;
    const projectedValue = p1.value + line.slope * (lastIndex - p1.index);
    
    // Discard if projected value is negative
    if (projectedValue <= 0) return false;
    
    return true;
  });

  filteredLines.sort((a, b) => b.touches - a.touches || b.points[1].index - a.points[1].index);

  // Không giới hạn số lượng đường trendline
  const bestLines = filteredLines;

  const lines = bestLines.map(line => {
    const p1 = line.points[0];
    const lastIndex = candles.length - 1;
    const lastTime = candles[lastIndex].time;
    
    const startValue = p1.value;
    const projectedValue = p1.value + line.slope * (lastIndex - p1.index);
    
    // Ensure strictly ascending times
    const finalPoints = p1.time >= lastTime 
      ? [{ time: p1.time, value: startValue }]
      : [
          { time: p1.time, value: startValue },
          { time: lastTime, value: projectedValue }
        ];
    
    return {
      type: line.type,
      points: finalPoints,
      slope: line.slope,
      p1Index: p1.index,
      p1Value: p1.value,
      p1Time: p1.time,
      touches: line.touches,
      timeframe: undefined as string | undefined
    };
  }).filter(line => line.points.length >= 2);

  return { lines };
}

export interface PivotPoints {
  p: number; r1: number; s1: number; r2: number; s2: number; r3: number; s3: number;
}

// Tham số đầu vào là (High, Low, Close) của CÂY NẾN NGÀY HÔM TRƯỚC (D1)
export function calculateStandardPivots(prevDayHigh: number, prevDayLow: number, prevDayClose: number): PivotPoints {
  const p = (prevDayHigh + prevDayLow + prevDayClose) / 3;
  const r1 = (2 * p) - prevDayLow;
  const s1 = (2 * p) - prevDayHigh;
  const r2 = p + (prevDayHigh - prevDayLow);
  const s2 = p - (prevDayHigh - prevDayLow);
  const r3 = prevDayHigh + 2 * (p - prevDayLow);
  const s3 = prevDayLow - 2 * (prevDayHigh - p);
  
  return { p, r1, s1, r2, s2, r3, s3 };
}

export interface TouchSignal {
  type: 'LONG' | 'SHORT';
  price: number;
  reason: string;
  distancePct: number;
}

export function detectUpcomingTouches(
  currentPrice: number,
  currentTime: number,
  smartTrendlines: ReturnType<typeof calculateSmartTrendlines>,
  dailyPivots: TimeframePivot | null,
  srLevels: SRLevel[]
): TouchSignal[] {
  const signals: TouchSignal[] = [];
  const threshold = 0.0015; // Ngưỡng báo động: 0.15% (rất sát)

  // 1. Kiểm tra va chạm với Trendline
  smartTrendlines.lines.forEach(line => {
    if (line.points.length < 2) return;
    const targetPrice = line.points[1].value; // Projected value at the current candle
    const distance = Math.abs(currentPrice - targetPrice) / currentPrice;
    
    if (distance < threshold) {
      const tfStr = line.timeframe ? ` (${line.timeframe})` : '';
      signals.push({
        type: line.type === 'upper' ? 'SHORT' : 'LONG',
        price: targetPrice,
        reason: `Giá sắp chạm ${line.type === 'upper' ? 'Upper' : 'Lower'} Trendline${tfStr}`,
        distancePct: distance * 100
      });
    }
  });

  // 2. Kiểm tra va chạm với Standard Pivots
  if (dailyPivots) {
    const levels = [
      { name: 'S1', value: dailyPivots.s1, action: 'LONG' },
      { name: 'S2', value: dailyPivots.s2, action: 'LONG' },
      { name: 'S3', value: dailyPivots.s3, action: 'LONG' },
      { name: 'R1', value: dailyPivots.r1, action: 'SHORT' },
      { name: 'R2', value: dailyPivots.r2, action: 'SHORT' },
      { name: 'R3', value: dailyPivots.r3, action: 'SHORT' }
    ];

    levels.forEach(level => {
      const distance = Math.abs(currentPrice - level.value) / currentPrice;
      if (distance < threshold) {
        signals.push({
          type: level.action as 'LONG' | 'SHORT',
          price: level.value,
          reason: `Giá sắp test vùng ${level.name} (${level.value.toFixed(2)})`,
          distancePct: distance * 100
        });
      }
    });
  }

  // 3. Check SR Levels
  srLevels.forEach(level => {
    if (level.distancePct < threshold * 100) {
      signals.push({
        type: level.type === 'SUPPORT' ? 'LONG' : 'SHORT',
        price: level.price,
        reason: `Test vùng ${level.type === 'SUPPORT' ? 'Hỗ trợ' : 'Kháng cự'} mạnh`,
        distancePct: level.distancePct
      });
    }
  });

  // Sắp xếp tín hiệu ưu tiên vùng cản gần nhất
  return signals.sort((a, b) => a.distancePct - b.distancePct);
}

export type SignalType = 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING' | 'HAMMER' | 'SHOOTING_STAR' | 'NONE';

export interface Signal {
  id: string;
  type: SignalType;
  action: 'LONG' | 'SHORT' | 'WAIT';
  price: number;
  time: number;
  description: string;
  symbol: string;
  strategy?: string;
  step1?: string;
  step2?: string;
  stopLoss?: number;
  takeProfitScalp?: number;
  takeProfitSwing?: number;
  rr?: number;
  confidence?: number;
}

export function detectPattern(
  candles: Candle[], 
  symbol: string, 
  currentPivot: TimeframePivot | null = null
): Signal | null {
  // We no longer use pattern detection as requested by the user.
  // The user said: "Logic Đánh Chặn (Anticipatory Signal Engine) Hàm này sẽ thay thế cho detectPattern."
  // So we return null here to disable the old pattern detection.
  return null;
}

export function getIntervalSeconds(interval: string): number {
  const unit = interval.slice(-1);
  const value = parseInt(interval.slice(0, -1));
  switch (unit) {
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    case 'w': return value * 604800;
    case 'M': return value * 2592000; // Approx 30 days
    default: return 3600;
  }
}
