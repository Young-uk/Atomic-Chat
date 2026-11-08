import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { SCREEN_JXA_SOURCE } from './agent-source/suite/tools/os/screen/screen-jxa.mjs'

function hitFixture(axPid, axOk = true) {
 const apps = { 1: { localizedName:'Dock',bundleIdentifier:'com.apple.dock',processIdentifier:1,isNil:()=>false },2: { localizedName:'Chrome',bundleIdentifier:'com.google.Chrome',processIdentifier:2,isNil:()=>false } }
 const windows=[{kCGWindowBounds:{X:0,Y:0,Width:1512,Height:982},kCGWindowOwnerPID:1,kCGWindowAlpha:1}]
 const dollar = Object.assign(x=>x,{
  NSRunningApplication:{runningApplicationWithProcessIdentifier:pid=>apps[pid]},
  AXUIElementCreateSystemWide:()=>({}),
  AXUIElementCopyElementAtPosition:(_root,_x,_y,out)=>{out[0]={};return axOk?0:1},
  AXUIElementGetPid:(_el,out)=>{out[0]=axPid;return 0},
  CGWindowListCopyWindowInfo:()=>windows,
 })
 return runInNewContext(SCREEN_JXA_SOURCE+'\nownerAt', { ObjC:{import(){},unwrap:x=>x,deepUnwrap:x=>x,castRefToObject:x=>x}, $:dollar,Ref:()=>[] })
}
test('transparent Dock bounds cannot override the actual Chrome hit target',()=>{
 assert.equal(hitFixture(2)(665,874.1).bundleId,'com.google.Chrome')
})
test('actual Dock hit remains Dock, never a click-through Chrome target',()=>{
 assert.equal(hitFixture(1)(665,874.1).bundleId,'com.apple.dock')
})
test('ambiguous Dock rectangles without AX evidence are refused',()=>{
 assert.equal(hitFixture(null,false)(665,874.1),null)
})
