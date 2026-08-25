import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

test('Settings opens the canonical Projects screen instead of the legacy saves pane', () => {
  assert.match(main, /<div class="setGroupHead">Projects<\/div>[\s\S]*?data-set="projects"[\s\S]*?Saved projects[\s\S]*?data-projects-count/)
  assert.match(main, /function openProjectsScreen\(\): void \{[\s\S]*?reconcileLibraryProjectDocuments\(\)[\s\S]*?closeSettings\(\)[\s\S]*?boardsView\.open\('projects'\)[\s\S]*?#libRoot \.libClose/)
  assert.match(main, /k === 'projects'\) openProjectsScreen\(\)/)
  assert.match(main, /openProjects: \(\) => openProjectsScreen\(\)/)
})

test('Settings keeps project count, last update, and device transfer separate', () => {
  assert.match(main, /data-projects-row[\s\S]*?data-projects-count[\s\S]*?Last updated[\s\S]*?data-projects-updated-time/)
  assert.match(main, /function projectCountLabels\(\)[\s\S]*?library\.projects\.length/)
  assert.match(main, /orderedProjects\(library\)\[0\]\?\.updated/)
  assert.match(main, /window\.setInterval\(renderProjectsLastUpdated, 1000\)/)
  assert.match(main, /<button class="setItem" data-goto="boards">[\s\S]*?Move to another device/)
  assert.match(main, /boards: 'Move to another device'/)
  assert.match(main, /data-set="boards-export"[\s\S]*?data-boards-file[\s\S]*?Boards on this device[\s\S]*?data-saves-host/)
})
