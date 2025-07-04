#!/usr/bin/env sh

echo 'Starting up...'

# Start jad-bot if it stops unexpectedly
echo 'Starting jad-bot...'
while true; do
    monika -c jadwal.yml --status-notification false
    echo "jad-bot exited with status $?. Restarting in 5 seconds..."
    sleep 5
done &

JAD_BOT_PID=$!

echo 'jad-bot started'

# Tailscale setup
echo 'Setting up Tailscale...'

modprobe xt_mark

echo 'net.ipv4.ip_forward = 1' | tee -a /etc/sysctl.conf
echo 'net.ipv6.conf.all.forwarding = 1' | tee -a /etc/sysctl.conf
sysctl -p /etc/sysctl.conf

iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
ip6tables -t nat -A POSTROUTING -o eth0 -j MASQUERADE

iptables -N ts-input 2>/dev/null || true
iptables -C INPUT -j ts-input 2>/dev/null || iptables -A INPUT -j ts-input

# Add iptables rules for DNS
iptables -I ts-input -p udp --dport 53 -j ACCEPT
iptables -I ts-input -p tcp --dport 53 -j ACCEPT

iptables -t nat -A PREROUTING -p udp --dport 53 -j REDIRECT --to-port 5053
iptables -t nat -A PREROUTING -p tcp --dport 53 -j REDIRECT --to-port 5053

# Add ip6tables rules for DNS
ip6tables -I ts-input -p udp --dport 53 -j ACCEPT
ip6tables -I ts-input -p tcp --dport 53 -j ACCEPT

ip6tables -t nat -A PREROUTING -p udp --dport 53 -j REDIRECT --to-port 5053
ip6tables -t nat -A PREROUTING -p tcp --dport 53 -j REDIRECT --to-port 5053

# Ensure the Tailscale state directory has correct permissions
mkdir -p /var/lib/tailscale
chmod 700 /var/lib/tailscale

mkdir -p /var/log
touch /var/log/unbound.log
chmod 644 /var/log/unbound.log

echo "Starting Unbound..."
unbound-checkconf /etc/unbound/unbound.conf || {
    echo "Unbound config check failed"
    exit 1
}

/usr/sbin/unbound -d > /var/log/unbound.log 2>&1 &
UNBOUND_PID=$!

echo "Unbound started with PID $UNBOUND_PID"

# Start Nginx
echo 'Starting Nginx...'
nginx -g 'daemon off;' &
NGINX_PID=$!

echo 'Nginx started'

# Remove /.fly directory
rm -rf /.fly
for FLY_PID in $(pgrep ^/.fly); do kill $FLY_PID; done

echo 'Removed /.fly directory and killed associated processes'

# Create and replace hallpass
echo '#!/bin/sh' > /tmp/dummy_hallpass
echo 'exit 0' >> /tmp/dummy_hallpass
chmod +x /tmp/dummy_hallpass
mv /tmp/dummy_hallpass /.fly/hallpass

echo 'Replaced /.fly/hallpass with dummy program'

# Start tailscaled with the statedir flag
/app/tailscaled --verbose=1 --port 41641 --socks5-server=localhost:3215 --tun=userspace --statedir=/var/lib/tailscale &
sleep 5

until /app/tailscale up \
    --authkey=${TAILSCALE_AUTH_KEY} \
    --hostname=ntrance-${FLY_REGION} \
    --advertise-exit-node \
    --accept-routes \
    --ssh
do
    sleep 0.1
done
# Wait for processes to finish
wait $JAD_BOT_PID
wait $NGINX_PID
wait $UNBOUND_PID

# Keep the container running
tail -f /dev/null