# Site Win7 Med

Site institucional de uma página para a Win7 Med, construído a partir do perfil do Instagram [@win7med](https://www.instagram.com/win7med).

## Arquivos

- `index.html`: página completa (HTML + CSS inline, sem build).
- `assets/marca-7.svg`: símbolo "7" nas cores da marca (favicon e ícones).
- `assets/win7-logo.png` e `assets/win7-logo-white.png`: logo Win7.
- `assets/equipe.jpg`: **não incluído**. Salve a foto da equipe com esse nome e ela aparece automaticamente na seção "A Win7 Med".

## Como publicar

Qualquer hospedagem estática serve. Exemplos:

```bash
# Firebase Hosting (a partir da raiz do repositório)
npx firebase-tools deploy --only hosting

# ou simplesmente copiar a pasta win7med-site/ para o servidor
```

Para testar localmente:

```bash
cd win7med-site && python3 -m http.server 8080
```

## O que veio do Instagram

Bio, destaques (Resultados, Método Win7, JPR, Localização, A Win7 Med, Partner Premier), link do WhatsApp, case auditado (R$ 19.836 investido, R$ 473.616 faturado, +2.287% ROI, 23,88x), temas dos reels e a estética (azul-marinho, dourado, serifa itálica).

## O que precisa ser conferido

Estes trechos foram escritos a partir dos destaques, mas sem acesso ao conteúdo interno deles:

- **Método Win7**: os 4 passos da seção `#metodo`.
- **JPR**: o texto do painel `#jpr` assume participação no evento.
- **Localização**: "Sede em Brasília (DF)" no painel `#localizacao`.
- **Transparência de resultados**: os três itens da lista em `#resultados`.
- **Contagem de seguidores** (4.332) na seção de conteúdo. Atualize ou remova.
