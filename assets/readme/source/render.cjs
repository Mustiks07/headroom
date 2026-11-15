const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../../..');
async function main() {
  const subject = fs.readFileSync(path.join(__dirname, 'hero-subject.png'));
  const metadata = await sharp(subject).metadata();
  if (!metadata.hasAlpha) throw new Error('Hero subject must preserve transparency');
  let svg = fs.readFileSync(path.join(__dirname, 'hero-layout.svg'), 'utf8');
  svg = svg.replace('xlink:href="hero-subject.png"', `xlink:href="data:image/png;base64,${subject.toString('base64')}"`);
  const dest = path.join(root,'assets/readme/hero.png');
  await sharp(Buffer.from(svg),{density:144}).png().toFile(dest);
  const preview = path.resolve(root,'../artifacts/readme-preview');
  fs.mkdirSync(preview,{recursive:true});
  await sharp(Buffer.from(svg)).resize({width:900}).png().toFile(path.join(preview,'hero-900.png'));
  await sharp(Buffer.from(svg)).resize({width:360}).png().toFile(path.join(preview,'hero-360.png'));
  await sharp(path.join(root,'assets/readme/workflow.svg')).resize({width:900}).png().toFile(path.join(preview,'workflow-900.png'));
  const raw = await sharp(subject).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width:w,height:h,channels:ch}=raw.info;
  const alphas=[0,w-1,(h-1)*w,h*w-1].map(p=>raw.data[p*ch+ch-1]);
  console.log(JSON.stringify({hero:dest,sourceAlpha:metadata.hasAlpha,cornerAlpha:alphas,bytes:fs.statSync(dest).size}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
