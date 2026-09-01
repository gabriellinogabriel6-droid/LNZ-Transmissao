# LNZ Desktop

Aplicativo transmissor para usar junto com o LNZ Transmissão.

## O que ele faz

- Entra ou cria uma sala no mesmo servidor do site.
- Escolhe uma janela ou tela.
- Envia vídeo por WebRTC para quem está assistindo pelo site.
- No Windows, quando uma **janela** é escolhida, tenta capturar somente o áudio do processo daquela janela usando WASAPI Process Loopback.
- Discord e outros aplicativos ficam fora do áudio quando a captura por processo está ativa.
- Ao escolher **tela inteira**, o app transmite sem áudio isolado por segurança, em vez de misturar o Discord.

## Windows necessário

A captura por processo depende das APIs de Process Loopback do Windows. O recurso é voltado para Windows 10/11 compatível.

## Como gerar o .EXE sem CMD

1. Crie um repositório no GitHub, por exemplo `LNZ-Desktop`.
2. Envie todos os arquivos desta pasta para a raiz do repositório.
3. Abra a aba **Actions**.
4. Abra **Build LNZ Desktop Windows**.
5. Clique **Run workflow**.
6. Quando terminar, abra a execução e baixe o artefato **LNZ-Desktop-Windows**.
7. Dentro dele haverá o instalador e a versão portable `.exe`.

O Windows pode mostrar aviso do SmartScreen porque o aplicativo não possui certificado de assinatura de código.

## Uso

1. Abra o LNZ Desktop.
2. Coloque o endereço do seu site Render, por exemplo `https://seu-site.onrender.com`.
3. Digite seu nickname.
4. Crie uma sala ou informe o código de uma sala existente.
5. Escolha a janela do jogo/aplicativo.
6. Deixe marcada a opção de áudio do aplicativo.
7. Clique **Iniciar transmissão**.

Quem assiste não precisa instalar nada; continua usando o navegador.
