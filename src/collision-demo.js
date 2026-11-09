// 仅开发录屏：五个测试点分段重置，仍使用正式键盘控制器和碰撞求解，不替代手动验收。
import { Vector3 } from 'three';
export function startCollisionDemo({ scene, camera, controls, controller, world }) {
  const root=scene.getObjectByName('芽芽 · 真实模型');
  if(!root || !controller) throw new Error('请先等待模型加载');
  const caption=document.createElement('div'); caption.dataset.collisionCaption='';
  Object.assign(caption.style,{position:'fixed',top:'110px',right:'24px',padding:'12px',background:'#fffdf0',color:'#354c36',zIndex:30});document.body.append(caption);
  const emit=(type,code)=>window.dispatchEvent(new KeyboardEvent(type,{code,bubbles:true,cancelable:true}));
  const clear=()=>['KeyW','ShiftLeft','Space'].forEach(code=>emit('keyup',code));
  const tree=world.obstacles.find(o=>o.key==='tree'),nest=world.obstacles.find(o=>o.key==='nest');
  const edge=world.move({x:0,z:2.5},{x:0,z:10});
  const stages=[
    ['正面撞树',{x:tree.x+tree.radius+.75,z:tree.z},[-1,0]],
    ['斜着蹭过树干',{x:tree.x+tree.radius+.50,z:tree.z},[-.5,.866]],
    ['撞苔藓窝',{x:nest.x,z:nest.z+nest.radius+.75},[0,-1]],
    ['沿岛边缘走',edge,[1,.65]],
    ['在边缘处跳',edge,[0,1]],
  ];
  let stage=-1,stopped=false;const start=performance.now();world.debug.visible=true;
  function tick(){
    if(stopped)return;
    const elapsed=(performance.now()-start)/1000,index=Math.min(4,Math.floor(elapsed/3));
    if(index!==stage){
      stage=index;clear();controller.reset();root.updateMatrixWorld(true);
      const center=new Vector3();for(const name of ['tripo0_Left_Limb_0','tripo0_Right_Limb_0','tripo1_Left_Limb_0','tripo1_Right_Limb_0'])center.add(root.getObjectByName(name).getWorldPosition(new Vector3()));center.divideScalar(4);
      const [label,p,d]=stages[index];root.position.x+=p.x-center.x;root.position.z+=p.z-center.z;
      const dir=new Vector3(d[0],0,d[1]).normalize();
      controls.target.set(root.position.x,.85,root.position.z);camera.position.copy(controls.target).addScaledVector(dir,-13).add(new Vector3(0,9,0));camera.lookAt(controls.target);controls.update();
      caption.textContent=`脚本分段演示 ${index+1}/5 · ${label}`;
      emit('keydown','KeyW');emit('keydown','ShiftLeft');if(index===4)emit('keydown','Space');
    }
    if(elapsed<15)requestAnimationFrame(tick);else clear();
  }
  tick();return()=>{stopped=true;clear();caption.remove();};
}
