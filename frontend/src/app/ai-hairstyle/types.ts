export interface RedboxProduct {
  id: string;
  name: string;
  type: string;
  hold: string | null;
  base: string | null;
  size: string;
  emoji: string;
  shopeeUrl: string;
}

export interface HairstyleRecommendation {
  rank: number;
  category: string;
  name: string;
  description: string;
  whyItSuits: string;
  stylingProducts: string[];
  maintenanceLevel: 'low' | 'medium' | 'high';
  maintenanceFrequency: string;
  stylingTime: string;
  suitabilityScore: number;
}

export interface AvoidHairstyle {
  style: string;
  reason: string;
  category: string;
}

export interface HairstyleAnalysis {
  currentHair: {
    texture: string;
    density: string;
    length: string;
    currentStyle: string;
  };
  faceShape: string;
  recommendations: HairstyleRecommendation[];
  avoidHairstyles: AvoidHairstyle[];
  barberTip: string;
  groomingEssentials?: string[];
  recommendedProducts?: RedboxProduct[];
}

export type AnalysisState = 'idle' | 'uploading' | 'analyzing' | 'done' | 'error';
