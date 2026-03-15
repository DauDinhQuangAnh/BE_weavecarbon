ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS pending_until TIMESTAMPTZ;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS estimated_arrival_at TIMESTAMPTZ;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS actual_arrival_at TIMESTAMPTZ;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS simulation_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_shipments_company_simulation
  ON public.shipments (company_id, simulation_enabled, status);

WITH real_shipments AS (
  SELECT s.*
  FROM public.shipments s
  INNER JOIN public.companies c ON c.id = s.company_id
  WHERE NOT (
    LOWER(TRIM(COALESCE(c.name, ''))) = 'demo company'
    OR EXISTS (
      SELECT 1
      FROM public.company_members cm
      INNER JOIN public.users u ON u.id = cm.user_id
      WHERE cm.company_id = s.company_id
        AND u.is_demo_user = true
    )
  )
),
leg_metrics AS (
  SELECT
    rs.id AS shipment_id,
    COALESCE(dom.transport_mode, 'road') AS dominant_mode,
    COUNT(sl.id) AS leg_count,
    COALESCE(
      BOOL_AND(
        COALESCE(sl.duration_hours, 0) > 0
        OR COALESCE(sl.distance_km, 0) > 0
      ) FILTER (WHERE sl.id IS NOT NULL),
      false
    ) AS all_legs_have_eta_inputs,
    COALESCE(
      SUM(
        CASE
          WHEN COALESCE(sl.duration_hours, 0) > 0 THEN sl.duration_hours
          WHEN COALESCE(sl.distance_km, 0) > 0 THEN
            sl.distance_km / CASE sl.transport_mode
              WHEN 'road' THEN 45
              WHEN 'rail' THEN 60
              WHEN 'sea' THEN 30
              WHEN 'air' THEN 650
              ELSE 45
            END
            + CASE sl.transport_mode
              WHEN 'road' THEN 2
              WHEN 'rail' THEN 4
              WHEN 'sea' THEN 12
              WHEN 'air' THEN 6
              ELSE 2
            END
          ELSE 0
        END
      ),
      0
    ) AS leg_transit_hours
  FROM real_shipments rs
  LEFT JOIN public.shipment_legs sl ON sl.shipment_id = rs.id
  LEFT JOIN LATERAL (
    SELECT sl2.transport_mode
    FROM public.shipment_legs sl2
    WHERE sl2.shipment_id = rs.id
    ORDER BY COALESCE(sl2.distance_km, 0) DESC, sl2.leg_order ASC
    LIMIT 1
  ) dom ON true
  GROUP BY rs.id, dom.transport_mode
),
backfill AS (
  SELECT
    rs.id,
    CASE
      WHEN rs.pending_until IS NOT NULL THEN rs.pending_until
      ELSE rs.created_at + make_interval(mins => 240 + FLOOR(random() * 181)::int)
    END AS next_pending_until,
    CASE
      WHEN lm.all_legs_have_eta_inputs THEN lm.leg_transit_hours
      WHEN COALESCE(rs.total_distance_km, 0) > 0 THEN
        rs.total_distance_km / CASE lm.dominant_mode
          WHEN 'road' THEN 45
          WHEN 'rail' THEN 60
          WHEN 'sea' THEN 30
          WHEN 'air' THEN 650
          ELSE 45
        END
        + CASE lm.dominant_mode
          WHEN 'road' THEN 2
          WHEN 'rail' THEN 4
          WHEN 'sea' THEN 12
          WHEN 'air' THEN 6
          ELSE 2
        END
      ELSE NULL
    END
    + CASE
      WHEN LOWER(TRIM(COALESCE(rs.origin_country, ''))) <> LOWER(TRIM(COALESCE(rs.destination_country, '')))
       AND TRIM(COALESCE(rs.origin_country, '')) <> ''
       AND TRIM(COALESCE(rs.destination_country, '')) <> ''
      THEN 8
      ELSE 0
    END AS transit_hours
  FROM real_shipments rs
  LEFT JOIN leg_metrics lm ON lm.shipment_id = rs.id
)
UPDATE public.shipments s
SET
  pending_until = CASE
    WHEN b.transit_hours IS NOT NULL THEN b.next_pending_until
    ELSE NULL
  END,
  estimated_arrival_at = CASE
    WHEN b.transit_hours IS NOT NULL THEN b.next_pending_until + make_interval(secs => ROUND(b.transit_hours * 3600)::int)
    ELSE NULL
  END,
  estimated_arrival = CASE
    WHEN b.transit_hours IS NOT NULL THEN
      ((b.next_pending_until + make_interval(secs => ROUND(b.transit_hours * 3600)::int)) AT TIME ZONE 'UTC')::date
    ELSE NULL
  END,
  simulation_enabled = CASE
    WHEN b.transit_hours IS NOT NULL THEN true
    ELSE false
  END,
  updated_at = NOW()
FROM backfill b
WHERE s.id = b.id
  AND s.simulation_enabled IS DISTINCT FROM false
  AND (s.pending_until IS NULL OR s.estimated_arrival_at IS NULL);

WITH real_shipments AS (
  SELECT s.id
  FROM public.shipments s
  INNER JOIN public.companies c ON c.id = s.company_id
  WHERE NOT (
    LOWER(TRIM(COALESCE(c.name, ''))) = 'demo company'
    OR EXISTS (
      SELECT 1
      FROM public.company_members cm
      INNER JOIN public.users u ON u.id = cm.user_id
      WHERE cm.company_id = s.company_id
        AND u.is_demo_user = true
    )
  )
)
UPDATE public.shipments s
SET
  actual_arrival_at = COALESCE(
    s.actual_arrival_at,
    s.actual_arrival::timestamp AT TIME ZONE 'UTC',
    s.estimated_arrival_at,
    s.updated_at
  ),
  actual_arrival = COALESCE(
    s.actual_arrival,
    (
      COALESCE(
        s.actual_arrival_at,
        s.actual_arrival::timestamp AT TIME ZONE 'UTC',
        s.estimated_arrival_at,
        s.updated_at
      ) AT TIME ZONE 'UTC'
    )::date
  ),
  updated_at = NOW()
FROM real_shipments rs
WHERE s.id = rs.id
  AND s.status = 'delivered'
  AND (s.actual_arrival_at IS NULL OR s.actual_arrival IS NULL);

UPDATE public.shipments
SET
  estimated_arrival = (estimated_arrival_at AT TIME ZONE 'UTC')::date,
  updated_at = NOW()
WHERE estimated_arrival_at IS NOT NULL
  AND estimated_arrival IS DISTINCT FROM (estimated_arrival_at AT TIME ZONE 'UTC')::date;

UPDATE public.shipments
SET
  actual_arrival = (actual_arrival_at AT TIME ZONE 'UTC')::date,
  updated_at = NOW()
WHERE actual_arrival_at IS NOT NULL
  AND actual_arrival IS DISTINCT FROM (actual_arrival_at AT TIME ZONE 'UTC')::date;
