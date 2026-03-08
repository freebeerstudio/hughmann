/**
 * Advisor types for HughMann advisory panel.
 */

export interface Advisor {
  id: string
  name: string
  display_name: string
  role: string | null
  expertise: string[]
  system_prompt: string
  avatar_url: string | null
  created_at: string
}
