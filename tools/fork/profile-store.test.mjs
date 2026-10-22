import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const hooks=registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/src/renderer/store/modules/profiles.js')) {
  if(specifier==='../../../constants') return next(specifier+'.js',context);
  const source=specifier.includes('datastores')?'export const DBProfileHandlers = {find:async()=>globalThis.profileFixtureRows}':specifier.includes('colors')?'export const calculateColorLuminance = () => "#FFFFFF"; export const getRandomColor = () => ({value:"#000000"})':'export const deepCopy = value => structuredClone(value)';
  return {url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true};
 }
 return next(specifier,context);
}});
const {default:store}=await import('../../src/renderer/store/modules/profiles.js');hooks.deregister();
test('remote profile replacement removes ghosts, retains unrelated active selection and falls back when active profile was deleted',()=>{
 const state={activeProfile:'selected',profileList:[]};const main={_id:'allChannels',name:'All Channels',subscriptions:[]},selected={_id:'selected',name:'Trips',subscriptions:[]};
 store.mutations.setProfileList(state,[selected,main]);assert.equal(state.activeProfile,'selected');assert.equal(state.profileList[0]._id,'allChannels');
 store.mutations.setProfileList(state,[main,{...selected,name:'Renamed'}]);assert.equal(state.activeProfile,'selected');
 store.mutations.setProfileList(state,[main]);assert.equal(state.activeProfile,'allChannels');assert.equal(state.profileList.length,1);
});
test('initial startup with a deleted default remains on All Channels',async()=>{
 const state={activeProfile:'allChannels',profileList:[{_id:'allChannels'}]};
 globalThis.profileFixtureRows=[{_id:'allChannels',name:'All Channels',subscriptions:[]},{_id:'another',name:'Other profile',subscriptions:[]}];
 const updates=[];
 try {await store.actions.grabAllProfiles({state,rootState:{settings:{defaultProfile:'deleted'}},dispatch:async(key,value)=>updates.push([key,value]),commit:(key,value)=>store.mutations[key](state,value)});assert.equal(store.getters.getActiveProfile(state)._id,'allChannels');assert.deepEqual(updates,[['updateDefaultProfile','allChannels']]);}finally{delete globalThis.profileFixtureRows;}
});
