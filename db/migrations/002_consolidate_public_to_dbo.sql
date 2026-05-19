-- Move data from public.* (orphan schema) into dbo.* (where the Go app reads),
-- then drop the public.* tables. Idempotent and transactional.

BEGIN;

-- 1. Ledgers — public.qbledger has no activeflag, default to 1
INSERT INTO dbo.qbledger (qbguid, ledgername, activeflag)
SELECT qbguid, ledgername, 1
FROM public.qbledger
ON CONFLICT (qbguid) DO NOTHING;

-- 2. Voucher headers — cast timestamptz to timestamp
INSERT INTO dbo.qbvoucherheader (qbguid, voucherno, voucherdate, vouchertype, partyguid, activeflag)
SELECT qbguid, voucherno, voucherdate::timestamp, vouchertype, partyguid, activeflag
FROM public.qbvoucherheader
ON CONFLICT (qbguid) DO NOTHING;

-- 3. Voucher items — only insert rows whose parent header now exists,
--    default serialno=0 and itemguid=NULL where missing
INSERT INTO dbo.qbvoucheritems (qbguid, vchhdrguid, serialno, itemguid, docqty, activeflag)
SELECT i.qbguid, i.vchhdrguid, 0, NULL, i.docqty, i.activeflag
FROM public.qbvoucheritems i
WHERE EXISTS (SELECT 1 FROM dbo.qbvoucherheader h WHERE h.qbguid = i.vchhdrguid)
ON CONFLICT (qbguid) DO NOTHING;

-- 4. Voucher type — merge prefix/delimiter from public if dbo's are blank
INSERT INTO dbo.qbvouchertype (qbguid, prefixmanual, delimiterchar, activeflag)
SELECT qbguid, prefixmanual, delimiterchar, activeflag
FROM public.qbvouchertype
ON CONFLICT (qbguid) DO UPDATE SET
    prefixmanual  = COALESCE(EXCLUDED.prefixmanual,  dbo.qbvouchertype.prefixmanual),
    delimiterchar = COALESCE(EXCLUDED.delimiterchar, dbo.qbvouchertype.delimiterchar);

-- 5. Voucher number counter — public PKs on qbguid, dbo PKs on vchtypeguid.
--    Match on vchtypeguid and copy the latest counter value.
UPDATE dbo.qbvouchernumber d
SET vouchernumber = p.vouchernumber
FROM public.qbvouchernumber p
WHERE d.vchtypeguid = p.vchtypeguid;

-- 6. Drop the now-redundant public.* tables in FK-safe order
DROP TABLE IF EXISTS public.qbvoucheralterationitems;
DROP TABLE IF EXISTS public.qbvoucheralteration;
DROP TABLE IF EXISTS public.qbvoucheritems;
DROP TABLE IF EXISTS public.qbvoucherheader;
DROP TABLE IF EXISTS public.qbledger;
DROP TABLE IF EXISTS public.qbvouchertype;
DROP TABLE IF EXISTS public.qbvouchernumber;

COMMIT;
