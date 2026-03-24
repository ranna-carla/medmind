#!/bin/bash
# MedMind — Atualizar domínio no index.html
# Substitui URLs antigas pelo novo domínio

OLD_DOMAINS=(
    "medmindplus.netlify.app"
    "medmind.netlify.app"
    "medmindpro.netlify.app"
)
NEW_DOMAIN="medmind.win7med.com.br"
FILE="/Users/Shared/projects/medmindplus/index.html"

echo "Atualizando domínio para $NEW_DOMAIN..."

for old in "${OLD_DOMAINS[@]}"; do
    count=$(grep -c "$old" "$FILE" 2>/dev/null || echo 0)
    if [ "$count" -gt 0 ]; then
        sed -i '' "s|$old|$NEW_DOMAIN|g" "$FILE"
        echo "  Substituído '$old' → '$NEW_DOMAIN' ($count ocorrência(s))"
    fi
done

echo "Concluído."
