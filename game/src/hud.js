// hud.js — DOM HUD: health, armour, ammo, timer, score, money, killfeed,
// round banner, plant progress and prompts. Called once per rendered frame;
// it only touches the DOM when a value actually changed.

import { WEAPONS } from './weapons.js';
import { FREEZE_TIME } from './state.js';
import { roundClock } from './rounds.js';

const $ = (id) => document.getElementById(id);

function fmtClock(seconds) {
  const s = Math.ceil(seconds);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export function createHud() {
  const els = {
    root: $('hud'), health: $('health'), healthNum: $('health-num'), healthFill: $('health-fill'),
    armorNum: $('armor-num'), ammo: $('ammo'), ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'),
    weaponName: $('weapon-name'), grenades: $('grenades'), roundLabel: $('round-label'),
    scoreUs: $('score-us'), scoreThem: $('score-them'), timer: $('timer'), money: $('money'),
    feed: $('feed'), banner: $('banner'), plantbar: $('plantbar'), plantFill: $('plant-fill'),
    plantLabel: $('plant-label'), prompt: $('prompt'), hitmarker: $('hitmarker'),
    vignette: $('vignette'), crosshair: $('crosshair'),
  };
  const seen = {};
  function set(el, key, value, fn) {
    if (seen[key] === value) return;
    seen[key] = value;
    fn(el, value);
  }
  return {
    els,
    show() { els.root.hidden = false; },
    hide() { els.root.hidden = true; },
    hitmark(head) {
      els.hitmarker.classList.add('on');
      setTimeout(() => els.hitmarker.classList.remove('on'), 110);
    },
    hurt() {
      els.vignette.classList.add('on');
      setTimeout(() => els.vignette.classList.remove('on'), 220);
    },
    update(state) {
      const p = state.player;
      const def = WEAPONS[p.weapon];
      const slot = p.weapons[p.weapon];
      set(els.healthNum, 'hp', p.hp, (el, v) => { el.textContent = Math.max(0, Math.ceil(v)); });
      set(els.health, 'low', p.hp <= 30, (el, v) => el.classList.toggle('low', v));
      set(els.healthFill, 'hpf', p.hp, (el, v) => { el.style.width = Math.max(0, v) + '%'; });
      set(els.armorNum, 'arm', Math.ceil(p.armor), (el, v) => { el.textContent = v; });
      set(els.ammoMag, 'mag', slot.mag, (el, v) => { el.textContent = v; });
      set(els.ammoRes, 'res', slot.reserve, (el, v) => { el.textContent = '/ ' + v; });
      set(els.ammo, 'empty', slot.mag === 0, (el, v) => el.classList.toggle('empty', v));
      set(els.weaponName, 'wn', def.name + (p.reloading > 0 ? ' — reloading' : ''), (el, v) => { el.textContent = v; });
      set(els.grenades, 'gr', p.grenades, (el, v) => { el.textContent = 'Grenades: ' + v + '  [G]'; });
      set(els.roundLabel, 'rd', state.round, (el, v) => { el.textContent = 'Round ' + v; });
      set(els.scoreUs, 'su', state.scoreUs, (el, v) => { el.textContent = v; });
      set(els.scoreThem, 'st', state.scoreThem, (el, v) => { el.textContent = v; });
      const clock = roundClock(state);
      set(els.timer, 'tm', fmtClock(clock), (el, v) => { el.textContent = v; });
      set(els.timer, 'tmlow', clock <= 10 && state.phase === 'live', (el, v) => el.classList.toggle('low', v));
      set(els.money, 'mo', state.money, (el, v) => { el.textContent = '$' + v; });

      // Banner: freeze countdown, round result, match result.
      let banner = '';
      if (state.phase === 'freeze') banner = 'ROUND ' + state.round + '<small>Buy with B — round starts in ' + Math.ceil(FREEZE_TIME - state.phaseT) + 's</small>';
      else if (state.phase === 'roundEnd') banner = (state.roundWinner === 'us' ? 'ROUND WON' : 'ROUND LOST') + '<small>' + state.roundReason + ' · +$' + (state.roundWinner === 'us' ? 1000 : 500) + '</small>';
      else if (state.phase === 'matchEnd') banner = (state.matchWinner === 'us' ? 'MATCH WON' : 'MATCH LOST') + '<small>Final ' + state.scoreUs + ' — ' + state.scoreThem + ' · press R to play again</small>';
      set(els.banner, 'bn', banner, (el, v) => { el.innerHTML = v; el.hidden = !v; });

      // Plant progress bar and site prompt.
      const bomb = state.bomb;
      const showPlant = bomb.state === 'planting' || bomb.state === 'planted';
      set(els.plantbar, 'pb', showPlant, (el, v) => { el.hidden = !v; });
      if (showPlant) {
        const label = bomb.state === 'planting' ? 'Planting spike at Site ' + bomb.site + '…' : 'Spike planted at Site ' + bomb.site + ' — ' + Math.ceil(bomb.timer) + 's to detonation';
        set(els.plantLabel, 'pl', label, (el, v) => { el.textContent = v; });
        set(els.plantFill, 'pf', Math.round((bomb.state === 'planting' ? bomb.progress : 1 - bomb.timer / 35) * 100), (el, v) => { el.style.width = v + '%'; });
      }
      const nearSite = state.phase === 'live' && p.alive && bomb.state === 'carried' &&
        (Math.hypot(p.x - 24, p.z + 18) < 5.5 || Math.hypot(p.x + 24, p.z + 18) < 5.5);
      set(els.prompt, 'pr', nearSite, (el, v) => {
        el.hidden = !v;
        if (v) el.textContent = 'Hold E to plant the spike';
      });

      // Killfeed: last four lines, newest first.
      const feedHtml = state.feed.slice(-4).map((f) => '<div>' + f.text + '</div>').join('');
      set(els.feed, 'fd', feedHtml, (el, v) => { el.innerHTML = v; });
    },
  };
}
