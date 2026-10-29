import {readFileSync,writeFileSync,mkdirSync,readdirSync,copyFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
const root='android/app/src/main/java';
function findMain(dir){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const full=join(dir,entry.name);
  if(entry.isDirectory()){const found=findMain(full);if(found)return found;}
  if(entry.isFile()&&entry.name==='MainActivity.java')return full;
 }
 return null;
}
const mainPath=findMain(root);
if(!mainPath)throw new Error('Capacitor MainActivity.java not found');
let main=readFileSync(mainPath,'utf8');
const pkg=main.match(/^package\s+([\w.]+);/m)?.[1];
if(!pkg)throw new Error('MainActivity Java package missing');
const plugin=readFileSync('native/android/NativeSavePlugin.java','utf8').replace('PLACEHOLDER_PACKAGE',pkg);
writeFileSync(join(dirname(mainPath),'NativeSavePlugin.java'),plugin);
if(!main.includes('registerPlugin(NativeSavePlugin.class)')){
 if(!main.includes('import android.os.Bundle;'))main=main.replace(/^(package\s+[\w.]+;)/m,'$1\nimport android.os.Bundle;');
 main=main.replace(/public class MainActivity extends BridgeActivity\s*\{/,`public class MainActivity extends BridgeActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    registerPlugin(NativeSavePlugin.class);
    super.onCreate(savedInstanceState);
  }`);
 writeFileSync(mainPath,main);
}
console.log('Registered NativeSave Capacitor bridge in '+mainPath);
