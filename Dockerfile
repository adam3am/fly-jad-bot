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
    tzdata && \
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
    /.fly

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