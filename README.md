# LNZ Transmissão

Site de salas para compartilhamento de tela em tempo real usando Node.js, Socket.IO e WebRTC.

## O que esta versão tem

- Criar sala **pública** ou **privada**.
- Sala pública aparece automaticamente na lista da página inicial.
- Sala privada não aparece na lista e exige **código + senha**.
- Nickname com até 24 caracteres.
- Avatar opcional por imagem.
- Link de convite no formato `/room/XXXX-XXXX`.
- Lista de participantes dentro da sala.
- Qualquer participante pode iniciar o compartilhamento quando ninguém estiver transmitindo.
- Uma transmissão de tela por sala de cada vez.
- Compartilhamento de tela via WebRTC.
- Interface responsiva para PC e celular.
- Logo LNZ/Linozera incluída.

## Como iniciar no Windows

1. Instale o Node.js 20 ou superior.
2. Extraia a pasta do projeto.
3. Abra a pasta `LNZ-Transmissao`.
4. Clique na barra de endereço da pasta, digite `cmd` e pressione Enter.
5. Execute:

```bat
npm install
```

6. Depois execute:

```bat
npm start
```

7. Abra no navegador:

```text
http://localhost:3000
```

## Como testar com duas pessoas no mesmo PC

- Abra `http://localhost:3000` em uma janela normal.
- Crie uma sala.
- Copie o link da sala.
- Abra esse link em uma janela anônima.
- Entre com outro nickname.
- Na primeira janela, clique em **Compartilhar tela**.

## Importante para colocar online

O compartilhamento de tela do navegador precisa de **HTTPS** quando não estiver usando `localhost`.

Para funcionar melhor entre redes diferentes, configure um servidor TURN no `.env`:

```env
PORT=3000
TURN_URL=turn:seu-servidor-turn:3478
TURN_USERNAME=usuario
TURN_CREDENTIAL=senha
```

Sem TURN, o WebRTC ainda funciona em muitas redes, mas algumas conexões podem falhar por causa de NAT/firewall.

## Salas

As salas ficam na memória do servidor. Se o servidor reiniciar, as salas abertas são apagadas. Para uma versão de produção com salas persistentes, usuários, histórico e painel administrativo, use um banco de dados.


## Novo ajuste de foto/avatar

- Agora dá para clicar em **Ajustar foto** para aumentar ou recuar a imagem dentro do avatar.
- Também dá para **remover a foto** e escolher outra.
- O ajuste é salvo no navegador e aparece na sala.


## Link do Discord

Se quiser mostrar o botão do Discord no site, configure no ambiente da hospedagem:

```env
DISCORD_URL=https://discord.gg/seu-link
BRAND_NAME=LNZ Transmissão
```

No Render, isso pode ser adicionado em **Environment Variables**.


## Áudio da transmissão

O áudio do sistema fica **desligado por padrão**. Dentro da sala existe o botão **Áudio OFF / Áudio ON**. Ative somente quando quiser transmitir o som do PC junto com a tela.


## Proteção contra áudio do Discord

- O site solicita `systemAudio: exclude` ao navegador.
- Se a pessoa escolher **Tela inteira** ou **Janela**, qualquer faixa de áudio é removida antes da transmissão.
- O botão de áudio passa a permitir somente **áudio de uma aba do navegador**.
- Para transmitir som de um vídeo/site sem captar Discord, ative **Áudio da aba** e escolha a opção **Guia/Aba do Chrome** no seletor de compartilhamento.


## Modo anti-retorno

Nesta versão, o compartilhamento de tela transmite **somente vídeo**. Nenhum áudio do sistema, Discord, navegador ou notificações é enviado. Isso elimina o retorno/eco causado pela captura de áudio do computador.


## Discord oficial

O botão do Discord está configurado para:
`https://discord.gg/m67kQeZrns`


## Chat da sala

- Mensagens em tempo real entre os participantes.
- Envio de imagens, PDF, TXT, ZIP e documentos de escritório.
- Limite de 2 MB por arquivo.
- Executáveis e scripts perigosos são bloqueados.
- O histórico fica somente enquanto a sala existir no servidor.


## Ajuste avançado de foto

O editor de avatar agora permite:

- aumentar ou recuar a foto;
- mover a foto para cima ou para baixo;
- usar botões rápidos **Subir**, **Centralizar** e **Descer**;
- arrastar a própria foto no círculo com mouse ou toque;
- salvar a posição para que o mesmo enquadramento apareça na sala e no chat.

Esta versão também mantém o modo anti-retorno com a transmissão de tela sem áudio.
