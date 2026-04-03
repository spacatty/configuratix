-- Domain-level protocol/listener mode for passthrough (HTTP/HTTPS exposure)
-- Default http_and_https preserves current behavior (both 80 and 443)
ALTER TABLE dns_managed_domains ADD COLUMN IF NOT EXISTS listener_protocol VARCHAR(20) DEFAULT 'http_and_https';
-- 'http_only' = expose port 80 only
-- 'http_and_https' = expose both 80 and 443 (default, backward compatible)
-- 'https_only' = expose 443 only (no port 80, hardens SSL issuance)
