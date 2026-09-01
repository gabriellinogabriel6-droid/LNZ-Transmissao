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
