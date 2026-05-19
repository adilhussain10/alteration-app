-- alteration-app Postgres schema
--
-- Creates every table referenced by the Go handlers. The `dbo` schema name
-- is preserved from the SQL Server origin so the inlined SQL queries
-- (e.g. `FROM dbo.QbVoucherHeader`) continue to work without modification.
--
-- Apply with:
--   psql "$DATABASE_URL" -f db/migrations/001_init_postgres.sql

CREATE SCHEMA IF NOT EXISTS dbo;
SET search_path TO dbo, public;

-- ---------------------------------------------------------------------------
-- QuickBill-side tables (read by the bill picker / get / reports handlers).
-- The alteration app does not write to these; populate them via your own
-- import / sync process.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dbo.QbVoucherHeader (
    QBGUID       TEXT        PRIMARY KEY,
    VoucherNo    TEXT,
    VoucherDate  TIMESTAMP,
    VoucherType  INTEGER     NOT NULL,
    PartyGUID    TEXT,
    ActiveFlag   SMALLINT    NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS ix_qbvoucherheader_date
    ON dbo.QbVoucherHeader (VoucherDate DESC) WHERE ActiveFlag = 1;
CREATE INDEX IF NOT EXISTS ix_qbvoucherheader_party
    ON dbo.QbVoucherHeader (PartyGUID) WHERE ActiveFlag = 1;
CREATE INDEX IF NOT EXISTS ix_qbvoucherheader_no
    ON dbo.QbVoucherHeader (VoucherNo) WHERE ActiveFlag = 1;

CREATE TABLE IF NOT EXISTS dbo.QbVoucherItems (
    QBGUID      TEXT             PRIMARY KEY,
    VchHdrGUID  TEXT             NOT NULL REFERENCES dbo.QbVoucherHeader(QBGUID),
    SerialNo    INTEGER          NOT NULL DEFAULT 0,
    ItemGUID    TEXT,
    DocQty      DOUBLE PRECISION NOT NULL DEFAULT 0,
    ActiveFlag  SMALLINT         NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS ix_qbvoucheritems_hdr
    ON dbo.QbVoucherItems (VchHdrGUID) WHERE ActiveFlag = 1;

CREATE TABLE IF NOT EXISTS dbo.QbLedger (
    QBGUID      TEXT     PRIMARY KEY,
    LedgerName  TEXT,
    ActiveFlag  SMALLINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dbo.QbMaillingAddress (
    QBGUID       TEXT     PRIMARY KEY,
    LinkGUID     TEXT     NOT NULL,
    MobileNo     TEXT,
    AddressType  TEXT,
    ActiveFlag   SMALLINT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS ix_qbmaillingaddress_link
    ON dbo.QbMaillingAddress (LinkGUID) WHERE ActiveFlag = 1;

CREATE TABLE IF NOT EXISTS dbo.QbItemMaster (
    QBGUID           TEXT     PRIMARY KEY,
    StockNo          TEXT,
    ItemDescription  TEXT,
    ActiveFlag       SMALLINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dbo.QbVoucherType (
    QBGUID         TEXT     PRIMARY KEY,
    PrefixManual   TEXT,
    DelimiterChar  TEXT,
    ActiveFlag     SMALLINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dbo.QbVoucherNumber (
    VchTypeGuid    TEXT     PRIMARY KEY,
    VoucherNumber  INTEGER  NOT NULL DEFAULT 0,
    ActiveFlag     SMALLINT NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- Alteration tables (owned by this app — read and written by the handlers).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dbo.QbVoucherAlteration (
    QBGUID          TEXT       PRIMARY KEY,
    VoucherType     INTEGER    NOT NULL,
    VoucherNo       TEXT,
    VoucherDate     TIMESTAMP,
    VoucherHdrGUID  TEXT       NOT NULL REFERENCES dbo.QbVoucherHeader(QBGUID),
    PartyGUID       TEXT,
    InternalRefNo   TEXT,
    Status          SMALLINT   NOT NULL DEFAULT 0,
    CreatedBy       TEXT,
    CreatedAt       TIMESTAMP,
    QbUserId        TEXT,
    AlterId         INTEGER    NOT NULL DEFAULT 0,
    ActiveFlag      SMALLINT   NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS ix_qbvoucheralteration_hdr
    ON dbo.QbVoucherAlteration (VoucherHdrGUID) WHERE ActiveFlag = 1;

CREATE TABLE IF NOT EXISTS dbo.QbVoucherAlterationItems (
    QBGUID           TEXT      PRIMARY KEY,
    AlterationGUID   TEXT      NOT NULL REFERENCES dbo.QbVoucherAlteration(QBGUID),
    VoucherItemGUID  TEXT      NOT NULL,
    AlterationQty    INTEGER   NOT NULL,
    Remarks          TEXT,
    DeliveryDate     TIMESTAMP,
    Status           SMALLINT  NOT NULL DEFAULT 0,
    QbUserId         TEXT,
    AlterId          INTEGER   NOT NULL DEFAULT 0,
    ActiveFlag       SMALLINT  NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS ix_qbvoucheralterationitems_alt
    ON dbo.QbVoucherAlterationItems (AlterationGUID) WHERE ActiveFlag = 1;

-- ---------------------------------------------------------------------------
-- Required seed rows. The save handler reads these to allocate voucher
-- numbers for new alterations; without them, POSTs return 500.
-- Adjust prefix / delimiter to match your numbering convention.
-- ---------------------------------------------------------------------------

INSERT INTO dbo.QbVoucherType (QBGUID, PrefixManual, DelimiterChar, ActiveFlag)
VALUES ('6010-Alteration', 'ALT', '-', 1)
ON CONFLICT (QBGUID) DO NOTHING;

INSERT INTO dbo.QbVoucherNumber (VchTypeGuid, VoucherNumber, ActiveFlag)
VALUES ('6010-Alteration', 0, 1)
ON CONFLICT (VchTypeGuid) DO NOTHING;
