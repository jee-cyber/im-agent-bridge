'use strict';

const config = require('./config');
const { hasBusinessSignals } = require('./intent');

function requirementForProject(project) {
  return config.profile.requirementIds.find((item) => item.project === project) || null;
}

function detectProject(text) {
  const body = String(text || '');
  for (const key of config.profile.projectDetectOrder) {
    const project = config.projects[key];
    if (!project) continue;
    const requirement = requirementForProject(key);
    if (requirement?.pattern && requirement.pattern.test(body)) return key;
    if (project.detect && project.detect.test(body)) return key;
    if (project.orDip && config.dipKeywords && config.dipKeywords.test(body)) return key;
  }
  return config.defaultProject;
}

function projectMeta(project) {
  return config.projectMeta(project);
}

function hasProjectSignal(text) {
  const body = String(text || '');
  if (config.profile.requirementIds.some((item) => item.pattern && item.pattern.test(body))) return true;
  return Object.values(config.projects).some((project) => project.detect && project.detect.test(body));
}

function hasTriProjectBusinessSignals(text) {
  const body = String(text || '').trim();
  if (!body) return false;
  if (hasProjectSignal(body)) return true;
  return hasBusinessSignals(body);
}

module.exports = {
  detectProject,
  projectMeta,
  hasTriProjectBusinessSignals,
};
