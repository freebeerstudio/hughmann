/**
 * Domain → Customer ID Mapping
 *
 * Extracted from the Supabase adapter so non-adapter code
 * (vault-sync, etc.) can resolve customer IDs without importing
 * a concrete adapter.
 */

const CUSTOMER_IDS: Record<string, string> = {
  omnissa: '926a785c-2964-4eef-973c-c82f768d8a56',
  fbs: 'fdd7ce7f-5194-4dae-91c5-fd6b1b4d6a88',
  personal: 'fc64558e-2740-4005-883f-53388b7edad7',
}

export function domainToCustomerId(domain: string | null): string {
  if (!domain) return CUSTOMER_IDS.personal
  return CUSTOMER_IDS[domain.toLowerCase()] ?? CUSTOMER_IDS.personal
}
