ARG TSVERSION=1.84.0
ARG TSFILE=tailscale_${TSVERSION}_amd64.tgz

FROM alpine:latest as tailscale-build
ARG TSFILE
WORKDIR /app

RUN wget https://pkgs.tailscale.com/stable/${TSFILE} && \
  tar xzf ${TSFILE} --strip-components=1

FROM adam3am/jad-bot:latest as final

# Add ARG and ENV instructions here
ARG TAILSCALE_AUTH_KEY
ENV TAILSCALE_AUTH_KEY=$TAILSCALE_AUTH_KEY

# Install packages and set timezone
RUN apk update && \
    apk add --no-cache \
    ca-certificates \
    iptables \
    ip6tables \
    iproute2 \
    squid \
    dante-server \
    python3 \
    dnsmasq \
    jq \
    nginx \
    tzdata \
    unbound \
    bind-tools && \
    cp /usr/share/zoneinfo/Asia/Jakarta /etc/localtime && \
    echo "Asia/Jakarta" > /etc/timezone && \
    rm -rf /var/cache/apk/*

# Set timezone environment variable
ENV TZ=Asia/Jakarta

# Create necessary directories
RUN mkdir -p \
    /var/run/tailscale \
    /var/cache/tailscale \
    /var/lib/tailscale \
    /etc/squid/ \
    /.fly \
    /etc/unbound/var

RUN wget https://www.internic.net/domain/named.root -O /etc/unbound/var/root.hints && \
unbound-anchor -a "/etc/unbound/var/root.key" || true && \
chown -R unbound:unbound /etc/unbound/var

RUN cat > /etc/unbound/unbound.conf << 'EOF'
server:
    # Listen on Tailscale interface only (will be updated at startup)
    interface: 0.0.0.0
    port: 53
    do-ip4: yes
    do-ip6: no
    do-udp: yes
    do-tcp: yes

    # Access control (will be updated at startup)
    access-control: 0.0.0.0/0 allow

    # Privacy settings
    hide-identity: yes
    hide-version: yes
    qname-minimisation: yes
    
    # DNSSEC
    auto-trust-anchor-file: "/etc/unbound/var/root.key"
    root-hints: "/etc/unbound/var/root.hints"
    
    # Performance
    num-threads: 1
    msg-cache-slabs: 2
    rrset-cache-slabs: 2
    infra-cache-slabs: 2
    key-cache-slabs: 2
    
    # Memory usage for Alpine on small VPS
    rrset-cache-size: 8m
    msg-cache-size: 4m
    
    # Prefetch to improve performance
    prefetch: yes
    
    # No forwarding - fully recursive
    do-not-query-localhost: no
EOF

# Copy Tailscale files from build stage
COPY --from=tailscale-build /app/tailscaled /app/tailscaled
COPY --from=tailscale-build /app/tailscale /app/tailscale

# Copy configuration files (adjust paths as needed)
COPY start.sh /app/start.sh
COPY motd /etc/motd
COPY sockd.conf /etc/sockd.conf
COPY squid.conf /etc/squid/squid.conf
COPY dnsmasq.conf /etc/dnsmasq.conf
COPY nginx.conf /etc/nginx/nginx.conf

# Copy jad-bot configuration
COPY jadwal.yml /usr/jadwal.yml

WORKDIR /usr

# Make start.sh executable
RUN chmod +x /app/start.sh

# Run start script
CMD ["/app/start.sh"]