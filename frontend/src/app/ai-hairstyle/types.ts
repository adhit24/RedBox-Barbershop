export interface HairstyleAnalysis {
  face_shape: string;
  hair_type: string;
  hair_thickness: string;
  hair_density: string;
  current_hair_condition: string;
  recommended_hairstyles: string[];
  avoid_hairstyles: string[];
  styling_tips: string[];
  recommended_products: string[];
  recommended_hair_colors: string[];
  barber_instruction: string;
  confidence_score: number;
}

export type AnalysisState = 'idle' | 'uploading' | 'analyzing' | 'done' | 'error';
