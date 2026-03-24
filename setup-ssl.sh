#!/bin/bash
# MedMind — Configurar HTTPS após Certbot
# Execute com: bash setup-ssl.sh

DOMAIN="medmind.win7med.com.br"
WEBROOT="/Users/macmini-win7/projects/projects/medmindplus"
NGINX_CONF="/opt/homebrew/etc/nginx/servers/medmind.conf"

echo "Configurando HTTPS para $DOMAIN..."

cat > "$NGINX_CONF" << NGINXEOF
# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ {
        root $WEBROOT;
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}

# HTTPS
server {
    listen 443 ssl;
    server_name $DOMAIN;
    root $WEBROOT;
    index index.html;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # PWA — Service Worker sem cache
    location /sw.js {
        expires off;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # Assets estáticos com cache longo
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Manifest PWA
    location /manifest.json {
        add_header Content-Type application/manifest+json;
    }

    # SPA fallback
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Headers de segurança
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    # Gzip
    gzip on;
    gzip_types text/html text/css application/javascript application/json;
    gzip_min_length 1024;
}
NGINXEOF

nginx -t && brew services restart nginx

echo ""
echo "HTTPS configurado! Acesse: https://$DOMAIN"
echo ""
echo "Para renovação automática do certificado, adicione ao crontab:"
echo "  crontab -e"
echo "  0 3 * * * certbot renew --quiet && brew services restart nginx"
