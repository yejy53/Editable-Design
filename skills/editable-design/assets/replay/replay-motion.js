(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const INTRO_DURATION = 4700;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
  const randomBetween = (min, max) => Math.round(min + Math.random() * (max - min));

  function mount(viewer) {
    if (document.body.dataset.motionMounted === 'true') return;
    document.body.dataset.motionMounted = 'true';

    const { data, world, flowLines, detailPanel, selectStage, initialStage, getViewState } = viewer;
    const playButton = document.getElementById('play-replay');
    const playLabel = playButton?.querySelector('b');
    const playIcon = playButton?.querySelector('span');
    const status = document.getElementById('project-status');
    const stageNodes = new Map([...document.querySelectorAll('.stage-node')].map((node) => [node.dataset.stage, node]));
    const artifacts = [...document.querySelectorAll('.external-artifact')];
    const assetArtifacts = artifacts.filter((artifact) => artifact.classList.contains('asset')).slice(0, 4);
    const flowPaths = [...flowLines.querySelectorAll('.flow-path')];
    const introPaths = [...flowLines.querySelectorAll('.flow-path, .intro-path')];
    const pathById = new Map(flowPaths.map((path) => [path.id, path]));
    const mainAmbientPaths = flowPaths.filter((path) => !path.classList.contains('repair'));
    const repairAmbientPaths = flowPaths.filter((path) => path.classList.contains('repair'));
    let mode = 'intro';
    let ambientTimers = [];
    let activePulses = new Set();
    let showcaseAnimations = new Set();
    let showcaseCycle = 0;
    let mainAmbientIndex = 2;

    function animateElement(element, keyframes, options) {
      if (!element) return Promise.resolve();
      const animation = element.animate(keyframes, { fill: 'both', ...options });
      return animation.finished.catch(() => {}).finally(() => animation.cancel());
    }

    function setPlayState(playing, disabled = playing) {
      if (!playButton) return;
      playButton.disabled = disabled;
      playButton.classList.toggle('is-playing', playing);
      playButton.setAttribute('aria-pressed', String(playing));
      if (playLabel) playLabel.textContent = playing ? '播放中' : '播放轨迹';
      if (playIcon) playIcon.textContent = playing ? '●' : '▶';
    }

    function targetOpacity(path) {
      if (path.classList.contains('flow-artifact')) return .75;
      if (path.classList.contains('flow-main')) return .9;
      return 1;
    }

    async function runIntro() {
      const introStarted = performance.now();
      status?.classList.remove('is-lit');
      detailPanel.classList.remove('is-open');
      setPlayState(false, true);
      document.body.classList.add('is-intro');
      const { scale, tx, ty } = getViewState();
      const animations = [];

      animations.push(animateElement(world, [
        { opacity: 0, transform: `translate(${tx}px, ${ty}px) scale(${scale * .985})` },
        { opacity: 1, transform: `translate(${tx}px, ${ty}px) scale(${scale})` }
      ], { duration: 900, easing: 'cubic-bezier(.22,.72,.2,1)' }));

      [...document.querySelectorAll('.phase-nav button')].forEach((button, index) => {
        animations.push(animateElement(button, [
          { opacity: 0, transform: 'translateY(14px) scale(.985)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' }
        ], { duration: 650, delay: 260 + index * 220, easing: 'cubic-bezier(.22,.72,.2,1)' }));
      });

      [...stageNodes.values()].forEach((node, index) => {
        animations.push(animateElement(node, [
          { opacity: 0, transform: 'translateY(18px) scale(.99)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' }
        ], { duration: 720, delay: 420 + index * 90, easing: 'cubic-bezier(.22,.72,.2,1)' }));
      });

      artifacts.forEach((artifact, index) => {
        animations.push(animateElement(artifact, [
          { opacity: 0, transform: 'translateY(14px) scale(.98)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' }
        ], { duration: 650, delay: 1150 + index * 95, easing: 'cubic-bezier(.22,.72,.2,1)' }));
      });

      introPaths.forEach((path, index) => {
        const length = Math.max(1, path.getTotalLength());
        const opacity = targetOpacity(path);
        animations.push(animateElement(path, [
          { strokeDasharray: `${length} ${length}`, strokeDashoffset: length, opacity: 0 },
          { opacity, offset: .18 },
          { strokeDasharray: `${length} ${length}`, strokeDashoffset: 0, opacity }
        ], { duration: 620, delay: 1600 + index * 260, easing: 'cubic-bezier(.3,.75,.2,1)' }));
      });

      [
        ['flow-reference-plan', 2300],
        ['flow-plan-assets', 2900],
        ['flow-html-review', 3500],
        ['flow-review-html-repair', 4100]
      ].forEach(([pathId, delay]) => {
        animations.push(wait(delay).then(() => launchEnergy(pathById.get(pathId), { strong: true, duration: 600, intensity: .52 })));
      });

      const finalArtifacts = artifacts.filter((artifact) => artifact.classList.contains('render') || artifact.classList.contains('layers'));
      finalArtifacts.forEach((artifact) => {
        animations.push(animateElement(artifact, [
          { transform: 'translateY(0) scale(1)' },
          { transform: 'translateY(-4px) scale(1.035)', offset: .45 },
          { transform: 'translateY(0) scale(1)' }
        ], { duration: 600, delay: 4000, easing: 'cubic-bezier(.22,.72,.2,1)' }));
      });

      animations.push(wait(4350).then(() => status?.classList.add('is-lit')));
      await Promise.allSettled(animations);
      const remaining = INTRO_DURATION - (performance.now() - introStarted);
      if (remaining > 0) await wait(remaining);
      document.body.classList.remove('is-intro');
      setPlayState(false, false);
      if (initialStage) selectStage(initialStage.id, false);
      startAmbient();
    }

    function ambientAllowed() {
      return mode === 'ambient' && !document.hidden && getViewState().scale >= .20;
    }

    function removeAmbientPulses() {
      [...activePulses].filter((pulse) => !pulse.strong).forEach((pulse) => pulse.cancel());
    }

    function launchEnergy(path, { strong = false, duration = strong ? 720 : 1150, intensity = strong ? .96 : .58 } = {}) {
      if (!path) return Promise.resolve();
      const ambientCount = [...activePulses].filter((pulse) => !pulse.strong).length;
      if (!strong && (!ambientAllowed() || ambientCount >= 2)) return Promise.resolve();

      return new Promise((resolve) => {
        const color = path.dataset.color || '#ffffff';
        const group = document.createElementNS(SVG_NS, 'g');
        group.classList.add('energy-pulse');
        group.style.filter = `drop-shadow(0 0 ${strong ? 8 : 10}px ${color})`;
        const circleSizes = strong ? [9, 6, 4] : [12, 7.5, 4.5];
        const circles = circleSizes.map((radius) => {
          const circle = document.createElementNS(SVG_NS, 'circle');
          circle.setAttribute('r', String(radius));
          circle.setAttribute('fill', color);
          group.appendChild(circle);
          return circle;
        });
        flowLines.appendChild(group);
        const length = Math.max(1, path.getTotalLength());
        const started = performance.now();
        let frame = 0;
        let finished = false;
        const pulse = {
          strong,
          cancel() {
            if (finished) return;
            finished = true;
            cancelAnimationFrame(frame);
            path.classList.remove('is-arrow-lit');
            group.remove();
            activePulses.delete(pulse);
            resolve();
          }
        };
        activePulses.add(pulse);

        const tick = (now) => {
          if (finished) return;
          if (!strong && !ambientAllowed()) {
            pulse.cancel();
            return;
          }
          const progress = Math.min(1, (now - started) / duration);
          const envelope = Math.sin(Math.PI * progress) * intensity;
          circles.forEach((circle, index) => {
            const local = Math.max(0, progress - index * .028);
            const point = path.getPointAtLength(local * length);
            circle.setAttribute('cx', point.x.toFixed(2));
            circle.setAttribute('cy', point.y.toFixed(2));
            circle.setAttribute('opacity', String(envelope * (1 - index * .28)));
          });
          path.classList.toggle('is-arrow-lit', progress > .82);
          if (progress >= 1) pulse.cancel();
          else frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      });
    }

    function clearAmbientTimers() {
      ambientTimers.forEach(clearTimeout);
      ambientTimers = [];
    }

    function cancelShowcaseAnimations() {
      showcaseCycle += 1;
      [...showcaseAnimations].forEach((animation) => animation.cancel());
      showcaseAnimations.clear();
    }

    function showcaseAnimation(target, keyframes, options) {
      if (!target) return Promise.resolve();
      const animation = target.animate(keyframes, { fill: 'both', ...options });
      showcaseAnimations.add(animation);
      return animation.finished.catch(() => {}).finally(() => {
        showcaseAnimations.delete(animation);
        animation.cancel();
      });
    }

    async function emphasizeAsset(artifact, cycle) {
      if (!artifact || cycle !== showcaseCycle || !ambientAllowed()) return;
      const image = artifact.querySelector('img');
      await Promise.allSettled([
        showcaseAnimation(artifact, [
          { transform: 'translateY(0)', borderColor: '#e8b783', boxShadow: '0 15px 36px rgba(66,57,44,.13)' },
          { transform: 'translateY(-3px)', borderColor: '#e88731', boxShadow: '0 21px 44px rgba(121,72,30,.20)', offset: .34 },
          { transform: 'translateY(-3px)', borderColor: '#e88731', boxShadow: '0 21px 44px rgba(121,72,30,.20)', offset: .72 },
          { transform: 'translateY(0)', borderColor: '#e8b783', boxShadow: '0 15px 36px rgba(66,57,44,.13)' }
        ], { duration: 700, easing: 'cubic-bezier(.22,.72,.2,1)' }),
        showcaseAnimation(image, [
          { transform: 'scale(1)' },
          { transform: 'scale(1.015)', offset: .34 },
          { transform: 'scale(1.015)', offset: .72 },
          { transform: 'scale(1)' }
        ], { duration: 700, easing: 'cubic-bezier(.22,.72,.2,1)' })
      ]);
    }

    function scheduleAssetShowcase(initial = false) {
      if (mode !== 'ambient' || !assetArtifacts.length) return;
      const delay = initial ? 1500 : randomBetween(4000, 6000);
      const timer = setTimeout(async () => {
        ambientTimers = ambientTimers.filter((item) => item !== timer);
        const cycle = ++showcaseCycle;
        for (const artifact of assetArtifacts) {
          if (mode !== 'ambient' || cycle !== showcaseCycle) break;
          if (ambientAllowed()) await emphasizeAsset(artifact, cycle);
        }
        if (mode === 'ambient' && cycle === showcaseCycle) scheduleAssetShowcase(false);
      }, delay);
      ambientTimers.push(timer);
    }

    function scheduleAmbient(kind, initial = false) {
      if (mode !== 'ambient') return;
      const isRepair = kind === 'repair';
      const delay = initial ? (isRepair ? 1100 : 400) : (isRepair ? randomBetween(2600, 4000) : randomBetween(1800, 3000));
      const timer = setTimeout(async () => {
        ambientTimers = ambientTimers.filter((item) => item !== timer);
        const pool = isRepair ? repairAmbientPaths : mainAmbientPaths;
        if (ambientAllowed() && pool.length) {
          const path = isRepair ? pool[0] : pool[mainAmbientIndex++ % pool.length];
          await launchEnergy(path);
        }
        scheduleAmbient(kind, false);
      }, delay);
      ambientTimers.push(timer);
    }

    function startAmbient() {
      if (reducedMotion) return;
      clearAmbientTimers();
      mode = 'ambient';
      scheduleAmbient('main', true);
      scheduleAmbient('repair', true);
      scheduleAssetShowcase(true);
    }

    function stopAmbient() {
      clearAmbientTimers();
      removeAmbientPulses();
      cancelShowcaseAnimations();
    }

    function updatePlaybackFocus(stageId, visitedStages) {
      stageNodes.forEach((node, id) => {
        node.classList.toggle('is-current', id === stageId);
        node.classList.toggle('is-past', id !== stageId && visitedStages.has(id));
        node.classList.toggle('is-future', id !== stageId && !visitedStages.has(id));
      });
      artifacts.forEach((artifact) => {
        const current = artifact.dataset.stage === stageId;
        artifact.classList.toggle('is-current', current);
        artifact.classList.toggle('is-future', !current && !visitedStages.has(artifact.dataset.stage));
      });
      selectStage(stageId, false);
      const node = stageNodes.get(stageId);
      animateElement(node, [
        { filter: 'brightness(.96)', transform: 'translateY(0) scale(.995)' },
        { filter: 'brightness(1)', transform: 'translateY(-3px) scale(1.008)' }
      ], { duration: 360, easing: 'cubic-bezier(.22,.72,.2,1)' });
      animateElement(detailPanel, [{ opacity: .78 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    }

    async function runStrongFlow(path) {
      if (!path) return;
      path.classList.remove('is-future');
      path.classList.add('is-current');
      const overlay = document.createElementNS(SVG_NS, 'path');
      const color = path.dataset.color || '#ffffff';
      const length = Math.max(1, path.getTotalLength());
      const segment = Math.max(42, length * .18);
      overlay.setAttribute('d', path.getAttribute('d'));
      overlay.setAttribute('class', 'event-flow-pulse');
      overlay.setAttribute('stroke', color);
      overlay.setAttribute('stroke-width', path.classList.contains('repair') ? '11' : '14');
      overlay.style.strokeDasharray = `${segment} ${length}`;
      overlay.style.strokeDashoffset = String(length);
      overlay.style.filter = `drop-shadow(0 0 8px ${color})`;
      flowLines.appendChild(overlay);
      const sweep = animateElement(overlay, [
        { strokeDashoffset: length, opacity: 0 },
        { opacity: .96, offset: .12 },
        { strokeDashoffset: -segment, opacity: .92, offset: .88 },
        { strokeDashoffset: -segment, opacity: 0 }
      ], { duration: 720, easing: 'cubic-bezier(.35,.02,.22,1)' });
      await Promise.allSettled([sweep, launchEnergy(path, { strong: true, duration: 720 })]);
      overlay.remove();
      path.classList.remove('is-current');
      path.classList.add('is-past');
    }

    function clearPlaybackClasses() {
      document.body.classList.remove('is-playing');
      stageNodes.forEach((node) => node.classList.remove('is-current', 'is-past', 'is-future'));
      artifacts.forEach((artifact) => artifact.classList.remove('is-current', 'is-future'));
      flowPaths.forEach((path) => path.classList.remove('is-current', 'is-past', 'is-future', 'is-arrow-lit'));
    }

    async function playReplay() {
      if (reducedMotion || mode === 'intro' || mode === 'playing') return;
      stopAmbient();
      mode = 'playing';
      setPlayState(true, true);
      document.body.classList.add('is-playing');
      const visitedStages = new Set();
      flowPaths.forEach((path) => path.classList.add('is-future'));
      const execution = [
        { stage: 'input' },
        { path: 'flow-input-reference', stage: 'reference' },
        { path: 'flow-reference-plan', stage: 'plan' },
        { path: 'flow-plan-assets', stage: 'assets' },
        { path: 'flow-assets-html', stage: 'html' },
        { path: 'flow-html-review', stage: 'review' },
        { path: 'flow-review-html-repair', stage: 'html' },
        { path: 'flow-review-layers', stage: 'layers' }
      ];

      visitedStages.add(execution[0].stage);
      updatePlaybackFocus(execution[0].stage, visitedStages);
      await wait(420);
      for (const event of execution.slice(1)) {
        await runStrongFlow(pathById.get(event.path));
        visitedStages.add(event.stage);
        updatePlaybackFocus(event.stage, visitedStages);
        await wait(320);
      }
      await wait(520);
      clearPlaybackClasses();
      setPlayState(false, false);
      mode = 'ambient';
      await wait(900);
      startAmbient();
    }

    playButton?.addEventListener('click', playReplay);
    window.addEventListener('poster-replay-viewchange', (event) => {
      if (event.detail?.scale < .20) {
        removeAmbientPulses();
        cancelShowcaseAnimations();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        removeAmbientPulses();
        cancelShowcaseAnimations();
      }
    });

    if (reducedMotion) {
      mode = 'reduced';
      status?.classList.add('is-lit');
      setPlayState(false, true);
      if (playButton) playButton.title = '已按系统设置关闭动画';
      if (initialStage) selectStage(initialStage.id, false);
    } else {
      runIntro();
    }
  }

  window.__POSTER_REPLAY_MOTION__ = { mount };
})();
