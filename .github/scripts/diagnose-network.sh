#!/bin/bash

# OctoBeats Network Diagnostic Script
# This script helps identify the correct URL to access OctoBeats server from GitHub Actions runner

echo "🔍 OctoBeats Network Diagnostic"
echo "==============================="
echo ""

# Test URLs to try
TEST_URLS=(
    "http://localhost:8000"
    "http://127.0.0.1:8000"
    "http://host.docker.internal:8000"
    "http://172.17.0.1:8000"
    "http://10.0.2.2:8000"
    "http://192.168.1.1:8000"
)

echo "🌐 Testing network connectivity..."
echo ""

# Check basic network info
echo "📋 Network Information:"
echo "- Hostname: $(hostname)"
echo "- IP addresses:"
ip addr show 2>/dev/null | grep "inet " | awk '{print "  " $2}' || ifconfig 2>/dev/null | grep "inet " | awk '{print "  " $2}'
echo ""

# Test each URL
echo "🔗 Testing OctoBeats server URLs:"
echo ""

for url in "${TEST_URLS[@]}"; do
    echo -n "Testing $url ... "
    
    if curl -f -s --connect-timeout 3 "$url/api/status" > /dev/null 2>&1; then
        echo "✅ SUCCESS"
        echo "   Server is accessible at: $url"
        
        # Get server info
        response=$(curl -s "$url/api/status" 2>/dev/null)
        if [ $? -eq 0 ]; then
            status=$(echo "$response" | jq -r '.status // "unknown"' 2>/dev/null)
            echo "   Server status: $status"
        fi
        echo ""
        
        # Save the working URL
        echo "WORKING_URL=$url" > octobeats_server_url.env
        echo "✅ Working URL saved to: octobeats_server_url.env"
        break
    else
        echo "❌ FAILED"
    fi
done

echo ""
echo "🔧 Troubleshooting Tips:"
echo ""
echo "1. If no URLs work:"
echo "   - Ensure OctoBeats server is running"
echo "   - Check if server is bound to 0.0.0.0:8000 (not just 127.0.0.1:8000)"
echo "   - Verify firewall allows connections on port 8000"
echo ""
echo "2. If using Docker:"
echo "   - Try running runner with --network=host"
echo "   - Or use host.docker.internal:8000"
echo ""
echo "3. Manual testing:"
echo "   - From runner machine: curl http://localhost:8000/api/status"
echo "   - From host machine: curl http://localhost:8000/api/status"
echo ""
echo "4. Check OctoBeats server logs for connection attempts"
echo ""

# Additional network diagnostics
echo "🔍 Additional Network Diagnostics:"
echo ""

# Check if port 8000 is listening
echo "Checking if port 8000 is listening:"
netstat -tlnp 2>/dev/null | grep :8000 || ss -tlnp 2>/dev/null | grep :8000 || echo "Port 8000 not found in netstat/ss output"
echo ""

# Check routing
echo "Default gateway:"
ip route show default 2>/dev/null | head -1 || route -n 2>/dev/null | grep "^0.0.0.0" | head -1
echo ""

# Check DNS resolution
echo "DNS resolution test:"
nslookup host.docker.internal 2>/dev/null || echo "host.docker.internal not resolvable"
echo ""

echo "🎯 Diagnostic complete!"
echo "If a working URL was found, update your workflow to use it." 