import test from 'node:test';
import assert from 'node:assert/strict';
import {socialRhythm,socialRhythmPrompt,QQ_RHYTHM_POLICY,normalizeSocialRoutine} from './qq-social-rhythm.mjs';

test('Shanghai rhythm handles midnight boundaries independently of host timezone',()=>{
  for(const [utc,quiet,phase] of [
    ['2026-10-29T15:29:00Z',false,'准备休息'],
    ['2026-10-29T15:30:00Z',true,'休息时段'],
    ['2026-10-29T23:59:00Z',true,'休息时段'],
    ['2026-10-30T00:00:00Z',false,'上午']
  ]){const s=socialRhythm(Date.parse(utc));assert.equal(s.quiet,quiet);assert.equal(s.phase,phase);}
});
test('fatigue counts only recent delivered spontaneous turns, and recovers without a timer',()=>{
  const now=Date.parse('2026-10-29T04:00:00Z');
  const turns=Array.from({length:QQ_RHYTHM_POLICY.maxSpontaneousInWindow},(_,i)=>({at:now-i*1000}));
  assert.equal(socialRhythm(now,turns).allowSpontaneous,false);
  assert.equal(socialRhythm(now+QQ_RHYTHM_POLICY.burstWindowMs,turns).allowSpontaneous,true);
  assert.equal(socialRhythm(now,[{at:now+1000},{at:NaN}]).resting,false);
  assert.match(socialRhythmPrompt(now,turns),/对方继续找你时正常回应/);
});
test('editable same-day and overnight quiet windows, disabled windows and focus are deterministic',()=>{
  const at=Date.parse('2026-10-29T06:00:00Z');
  assert.equal(socialRhythm(at,[],{quietStart:'13:00',quietEnd:'15:00'}).quiet,true);
  assert.equal(socialRhythm(at,[],{quietStart:'15:00',quietEnd:'13:00'}).quiet,false);
  assert.equal(socialRhythm(at,[],{enabled:false,quietStart:'13:00',quietEnd:'15:00'}).quiet,false);
  assert.equal(socialRhythm(at,[],{quietStart:'14:00',quietEnd:'14:00'}).quiet,false);
  assert.equal(socialRhythm(at,[],{focus:true}).allowSpontaneous,false);
  assert.match(socialRhythmPrompt(at,[],{focus:true}),/明确找你仍正常回应/);
  for(const input of [null,[],{quietStart:'24:00'},{quietEnd:'9:00'},{enabled:'yes'},{focus:1}])assert.throws(()=>normalizeSocialRoutine(input,{strict:true}));
});
