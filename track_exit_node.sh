#!/bin/sh
# ============================================================
# Bandwidth Kill-Switch for Tailscale Exit Node
# Runs every minute via cron. Persists cumulative TX bytes
# across container restarts using the Fly Volume at
# /var/lib/tailscale.
#
# Safe limit: 28 GB (28,000,000,000 bytes) of Fly.io's
# 30 GB free Asia-Pacific outbound allowance.
# ============================================================

IFACE="tailscale0"
LIMIT=28000000000
TOTAL_FILE="/var/lib/tailscale/bw_total_bytes"
RAW_FILE="/var/lib/tailscale/bw_last_raw"
TAILSCALE="/app/tailscale"
TAG="BW_TRACK"

# -----------------------------------------------------------
# Read current TX bytes from the kernel counter
# -----------------------------------------------------------
TX_PATH="/sys/class/net/${IFACE}/statistics/tx_bytes"

if [ ! -f "$TX_PATH" ]; then
    echo "[$TAG] WARNING: $TX_PATH not found — interface not up yet"
    exit 0
fi

CURRENT=$(cat "$TX_PATH")

# -----------------------------------------------------------
# Read last raw reading (default 0 on first run)
# -----------------------------------------------------------
if [ -f "$RAW_FILE" ]; then
    LAST_RAW=$(cat "$RAW_FILE")
else
    LAST_RAW=0
fi

# -----------------------------------------------------------
# Calculate delta — detect container restart (counter reset)
# -----------------------------------------------------------
if [ "$CURRENT" -lt "$LAST_RAW" ]; then
    # Counter reset: container restarted, treat all current bytes as new
    DELTA=$CURRENT
    echo "[$TAG] Restart detected (cur=$CURRENT < last=$LAST_RAW). Delta=$DELTA"
else
    DELTA=$((CURRENT - LAST_RAW))
fi

# Save current as the new raw baseline
echo "$CURRENT" > "$RAW_FILE"

# -----------------------------------------------------------
# Update cumulative total (persisted on the Fly Volume)
# -----------------------------------------------------------
if [ -f "$TOTAL_FILE" ]; then
    TOTAL=$(cat "$TOTAL_FILE")
else
    TOTAL=0
fi

TOTAL=$((TOTAL + DELTA))
echo "$TOTAL" > "$TOTAL_FILE"

# -----------------------------------------------------------
# Human-readable output for fly logs
# -----------------------------------------------------------
TOTAL_MB=$((TOTAL / 1048576))
LIMIT_MB=$((LIMIT / 1048576))
echo "[$TAG] delta=${DELTA} total=${TOTAL} (${TOTAL_MB}MB / ${LIMIT_MB}MB)"

# -----------------------------------------------------------
# Kill-switch: disable exit node if limit reached
# -----------------------------------------------------------
if [ "$TOTAL" -ge "$LIMIT" ]; then
    echo "[$TAG] *** LIMIT REACHED (${TOTAL_MB}MB >= ${LIMIT_MB}MB) ***"
    echo "[$TAG] Disabling exit node..."
    $TAILSCALE up --advertise-exit-node=false
    echo "[$TAG] Exit node DISABLED. Will re-enable on monthly reset or redeploy."
fi
