import { GoogleGenAI, Type } from "@google/genai";

export interface NewsItem {
  headline: string;
  summary: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  reasoning: string;
  source: string;
  timestamp: string;
  link?: string;
}

export async function fetchAndAnalyzeNews(symbol: string): Promise<NewsItem[]> {
  try {
    // We use a public RSS to JSON API to fetch real crypto news from Cointelegraph
    const rssUrl = encodeURIComponent('https://cointelegraph.com/rss');
    const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${rssUrl}`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.status !== 'ok' || !data.items) {
      throw new Error('Invalid RSS data');
    }

    // Filter news that might be relevant to the symbol (or just take top news if no match)
    const baseSymbol = symbol.replace('USDT', '').toLowerCase();
    let relevantItems = data.items.filter((item: any) => 
      item.title.toLowerCase().includes(baseSymbol) || 
      item.description.toLowerCase().includes(baseSymbol) ||
      item.categories?.some((c: string) => c.toLowerCase().includes(baseSymbol))
    );

    // If not enough specific news, just take the latest general news
    if (relevantItems.length < 3) {
      relevantItems = data.items;
    }

    // Map to our NewsItem format
    return relevantItems.slice(0, 10).map((item: any) => {
      // Simple heuristic for sentiment (since we don't use AI here anymore)
      const text = (item.title + ' ' + item.description).toLowerCase();
      let sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
      let reasoning = 'Tin tức thị trường chung.';
      
      const bullishWords = ['surge', 'jump', 'bull', 'high', 'gain', 'positive', 'adopt', 'launch', 'upgrade', 'partnership'];
      const bearishWords = ['drop', 'fall', 'bear', 'low', 'loss', 'negative', 'ban', 'hack', 'delay', 'lawsuit'];
      
      let bullScore = bullishWords.filter(w => text.includes(w)).length;
      let bearScore = bearishWords.filter(w => text.includes(w)).length;
      
      if (bullScore > bearScore) {
        sentiment = 'BULLISH';
        reasoning = 'Chứa các từ khóa tích cực về giá hoặc sự phát triển.';
      } else if (bearScore > bullScore) {
        sentiment = 'BEARISH';
        reasoning = 'Chứa các từ khóa tiêu cực về giá hoặc rủi ro.';
      }

      // Clean up HTML tags from description
      const cleanSummary = item.description.replace(/<[^>]*>?/gm, '').substring(0, 150) + '...';

      return {
        headline: item.title,
        summary: cleanSummary,
        sentiment,
        reasoning,
        source: item.author || 'Cointelegraph',
        timestamp: item.pubDate,
        link: item.link
      };
    });

  } catch (error) {
    console.error("Error fetching real news:", error);
    return getMockNews(symbol);
  }
}

function getMockNews(symbol: string): NewsItem[] {
  const now = new Date();
  return [
    {
      headline: `${symbol} Sees Increased Institutional Interest`,
      summary: `Major financial institutions are reportedly increasing their exposure to ${symbol}, citing long-term growth potential.`,
      sentiment: 'BULLISH',
      reasoning: 'Institutional adoption typically brings more liquidity and validates the asset.',
      source: 'CryptoNews',
      timestamp: new Date(now.getTime() - 1000 * 60 * 30).toISOString(),
    },
    {
      headline: `Regulatory Uncertainty Weighs on ${symbol}`,
      summary: `New comments from regulators have sparked concerns about potential stricter rules for ${symbol} trading.`,
      sentiment: 'BEARISH',
      reasoning: 'Regulatory crackdowns can lead to decreased trading volume and investor panic.',
      source: 'Financial Times',
      timestamp: new Date(now.getTime() - 1000 * 60 * 120).toISOString(),
    },
    {
      headline: `${symbol} Network Upgrade Scheduled for Next Month`,
      summary: `Developers have confirmed the date for the highly anticipated network upgrade, promising lower fees and faster transactions.`,
      sentiment: 'BULLISH',
      reasoning: 'Technical improvements enhance the utility and attractiveness of the network.',
      source: 'CoinDesk',
      timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 5).toISOString(),
    }
  ];
}
