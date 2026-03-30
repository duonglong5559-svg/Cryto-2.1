import { GoogleGenAI, Type } from '@google/genai';
import { Candle } from './ta';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface AITrendline {
  type: 'upper' | 'lower';
  points: { time: number; value: number }[];
  reason: string;
  touches?: number;
}

export interface AITrendlinesResponse {
  lines: AITrendline[];
}

export async function fetchAITrendlines(symbol: string, interval: string, candles: Candle[], candidateLines: any[]): Promise<AITrendlinesResponse> {
  if (candidateLines.length === 0 || candles.length === 0) return { lines: [] };
  
  const currentPrice = candles[candles.length - 1].close;

  // Limit candidates to top 15 to avoid overwhelming the AI and save tokens
  // Sort by touches (descending), then by recency of p2
  const sortedCandidates = [...candidateLines].sort((a, b) => {
    if (b.touches !== a.touches) return b.touches - a.touches;
    return b.points[1].time - a.points[1].time;
  }).slice(0, 15);

  const candidatesText = sortedCandidates.map((line, index) => {
    const p1 = line.points[0];
    const p2 = line.points[1];
    const p1Date = new Date(p1.time * 1000).toISOString().replace('T', ' ').substring(0, 16);
    const p2Date = new Date(p2.time * 1000).toISOString().replace('T', ' ').substring(0, 16);
    return `ID: ${index} | Type: ${line.type} | Touches: ${line.touches} | Point 1: ${p1Date} at $${p1.value.toFixed(2)} | Point 2: ${p2Date} at $${p2.value.toFixed(2)}`;
  }).join('\n');

  const prompt = `You are an expert crypto technical analyst. I have mathematically calculated candidate trendlines for ${symbol} on the ${interval} timeframe. Current price is $${currentPrice}.
  
  Candidate Trendlines:
  ${candidatesText}
  
  Your task:
  1. Evaluate these candidate trendlines.
  2. Select ALL significant trendlines. Do not limit the number. If a line has strong touches (e.g., >= 3) or forms a clear boundary, select it.
  3. For each selected line, provide a brief 'reason' in Vietnamese explaining its significance (e.g., "Đường hỗ trợ cứng với 3 điểm chạm, cho thấy phe mua đang bảo vệ vùng giá này...").
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview', // Use flash for much faster response
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            selectedLines: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.INTEGER, description: "The ID of the selected candidate trendline" },
                  reason: { type: Type.STRING, description: "Reason in Vietnamese" }
                },
                required: ["id", "reason"]
              }
            }
          },
          required: ["selectedLines"]
        }
      }
    });

    const text = response.text;
    if (!text) return { lines: [] };
    
    const result = JSON.parse(text);
    const finalLines: AITrendline[] = [];
    
    if (result.selectedLines && Array.isArray(result.selectedLines)) {
      for (const selection of result.selectedLines) {
        const candidate = sortedCandidates[selection.id];
        if (candidate) {
          finalLines.push({
            type: candidate.type,
            points: candidate.points.map((p: any) => ({ time: p.time, value: p.value })),
            reason: selection.reason,
            touches: candidate.touches
          });
        }
      }
    }
    
    return { lines: finalLines };
  } catch (e) {
    console.error("Failed to fetch AI trendlines", e);
    return { lines: [] };
  }
}
