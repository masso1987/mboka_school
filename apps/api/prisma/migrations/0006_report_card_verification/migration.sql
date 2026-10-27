-- Public verification of a printed report card (Module 7 report-card content: verification code).
-- The runtime role cannot read report_cards without a tenant context (RLS), and the verifier has none.
-- This SECURITY DEFINER function returns exactly one card by its full, random code — no listing,
-- no partial match — and is the only cross-tenant read path for report cards.

CREATE OR REPLACE FUNCTION verify_report_card(p_code text)
  RETURNS TABLE (status text, version int, content jsonb, published_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT rc.status::text, rc.version, rc.content, rc.published_at
  FROM report_cards rc
  JOIN tenants t ON t.id = rc.tenant_id AND t.status = 'ACTIVE'
  WHERE rc.verification_code = p_code
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION verify_report_card(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mboka_app') THEN
    GRANT EXECUTE ON FUNCTION verify_report_card(text) TO mboka_app;
  END IF;
END $$;
