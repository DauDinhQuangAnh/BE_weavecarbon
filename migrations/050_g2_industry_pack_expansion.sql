-- G2-12 expands the governed Industry Pack pilot ledger without changing its append-only semantics.

ALTER TABLE public.industry_pack_pilot_snapshots
  DROP CONSTRAINT IF EXISTS industry_pack_pilot_snapshots_pack_id_check;

ALTER TABLE public.industry_pack_pilot_snapshots
  ADD CONSTRAINT industry_pack_pilot_snapshots_pack_id_check
  CHECK (pack_id IN (
    'steel',
    'cement',
    'textile_apparel',
    'aluminium',
    'construction_materials',
    'fertiliser_chemicals',
    'mining_minerals'
  ));

COMMENT ON TABLE public.industry_pack_pilot_snapshots IS
  'Append-only governed software-pilot snapshots. Industry Pack results require sector-expert and real-facility acceptance before official use.';
