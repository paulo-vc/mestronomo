// Roda depois do electron-builder montar a pasta do app (antes do instalador e do zip).
// Tira o dxcompiler.dll (~25 MB): é o compilador de shaders do WebGPU, que o Mestrônomo não usa
// (a aceleração de GPU fica desligada e a interface não tem 3D nem vídeo).
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function depoisDeEmpacotar(context) {
  for (const dll of ['dxcompiler.dll', 'dxil.dll']) {
    const arquivo = path.join(context.appOutDir, dll);
    if (fs.existsSync(arquivo)) {
      const mb = (fs.statSync(arquivo).size / 1024 / 1024).toFixed(1);
      fs.rmSync(arquivo);
      console.log(`  • removido ${dll} (${mb} MB, só usado pelo WebGPU)`);
    }
  }
};
