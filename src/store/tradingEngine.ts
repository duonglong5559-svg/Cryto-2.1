import { create } from 'zustand';
import { Candle, calculateSmartTrendlines, detectUpcomingTouches, TouchSignal, detectSRLevels } from '../lib/ta';
import { TimeframePivot } from '../lib/binance';

interface EngineState {
  candles: Candle[];
  currentPrice: number;
  smartTrendlines: ReturnType<typeof calculateSmartTrendlines>;
  dailyPivots: TimeframePivot | null;
  activeSignals: TouchSignal[]; // Tín hiệu nhấp nháy trên biểu đồ
  
  // Các hàm (Actions)
  initData: (historicalCandles: Candle[], pivots: TimeframePivot | null) => void;
  processNewTick: (tickCandle: Candle) => void;
}

export const useTradingEngine = create<EngineState>((set, get) => ({
  candles: [],
  currentPrice: 0,
  smartTrendlines: { lines: [] },
  dailyPivots: null,
  activeSignals: [],

  // 1. Chạy 1 lần duy nhất khi mới mở App
  initData: (historicalCandles, pivots) => {
    // Tính toán trước các cản cứng tốn thời gian (O(N))
    const initialTrendlines = calculateSmartTrendlines(historicalCandles);
    
    set({ 
      candles: historicalCandles, 
      dailyPivots: pivots,
      smartTrendlines: initialTrendlines,
      currentPrice: historicalCandles[historicalCandles.length - 1].close
    });
  },

  // 2. Chạy liên tục mỗi phần nghìn giây khi có giá mới từ Binance
  processNewTick: (tickCandle) => {
    const state = get();
    const updatedCandles = [...state.candles];
    
    // Cập nhật nến hiện tại hoặc thêm nến mới
    if (updatedCandles.length > 0 && tickCandle.time === updatedCandles[updatedCandles.length - 1].time) {
      updatedCandles[updatedCandles.length - 1] = tickCandle;
    } else {
      updatedCandles.push(tickCandle);
      if (updatedCandles.length > 500) updatedCandles.shift(); // Chống tràn RAM
    }

    const currentPrice = tickCandle.close;
    const currentTime = tickCandle.time as number;
    const srLevels = detectSRLevels(updatedCandles, currentPrice);

    // ĐỘNG CƠ CỐT LÕI: Quét tín hiệu đánh chặn (Độ phức tạp chỉ là O(1), cực nhẹ)
    const newSignals = detectUpcomingTouches(
      currentPrice,
      currentTime,
      state.smartTrendlines, // Dùng lại trendline đã tính, KHÔNG tính lại
      state.dailyPivots,
      srLevels
    );

    // *Tối ưu nâng cao:* Chỉ tính toán lại Trendline khi kết thúc 1 cây nến (isClosed = true)
    let newTrendlines = state.smartTrendlines;
    if (tickCandle.isClosed) {
      newTrendlines = calculateSmartTrendlines(updatedCandles);
    }

    set({ 
      candles: updatedCandles,
      currentPrice: currentPrice,
      smartTrendlines: newTrendlines,
      activeSignals: newSignals // Đẩy tín hiệu ra để Chart nhấp nháy
    });
  }
}));
