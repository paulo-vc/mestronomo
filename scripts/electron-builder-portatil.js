// Configuração da versão portátil: a mesma do instalador, mas empacotada em .zip e com o
// portatil.txt ao lado do executável (é ele que liga o modo portátil no app).
const { build } = require('../package.json');

module.exports = {
  ...build,
  win: { ...build.win, target: 'zip', artifactName: 'Mestronomo-Portatil-${version}.${ext}' },
  extraFiles: [{ from: 'build/portatil.txt', to: 'portatil.txt' }],
};
