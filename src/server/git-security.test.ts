import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getCommitDiffAsync, getFullDiff, getFullDiffAsync, worktreeAdd } from './git.js'

const cleanups: string[] = []
afterEach(() => {
  for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true })
})

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function scenario() {
  const root = mkdtempSync(join(tmpdir(), 'diffo-git-security-'))
  cleanups.push(root)
  const repo = join(root, 'repo')
  git(root, 'init', '-q', '-b', 'main', repo)
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'sample.txt'), 'before\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  writeFileSync(join(repo, 'sample.txt'), 'after\n')
  git(repo, 'commit', '-qam', 'change')
  return { root, repo, base, head: git(repo, 'rev-parse', 'HEAD') }
}

describe('review Git safety', () => {
  it.each(['sync', 'async', 'commit'] as const)(
    '%s diffs never execute a configured text converter',
    async (mode) => {
      const { repo, base, head } = scenario()
      writeFileSync(join(repo, '.gitattributes'), '*.txt diff=probe\n')
      // A converter that fails makes a diff fail if Git tries to execute it.
      git(repo, 'config', 'diff.probe.textconv', 'exit 99;')
      writeFileSync(join(repo, 'sample.txt'), 'working edit\n')
      const spec = { kind: 'branch', base } as const
      const diff =
        mode === 'sync'
          ? getFullDiff(repo, spec)
          : mode === 'async'
            ? await getFullDiffAsync(repo, spec)
            : await getCommitDiffAsync(repo, head)
      expect(diff).toContain(mode === 'commit' ? '+after' : '+working edit')
    },
  )

  it('does not run checkout or reference-transaction hooks when creating a review worktree', () => {
    const { root, repo, head } = scenario()
    const hooks = join(root, 'hooks')
    mkdirSync(hooks)
    for (const name of ['post-checkout', 'reference-transaction']) {
      writeFileSync(join(hooks, name), '#!/bin/sh\nprintf ran > hook-ran\n', { mode: 0o755 })
    }
    git(repo, 'config', 'core.hooksPath', hooks)
    const worktree = join(root, 'review')
    worktreeAdd(repo, worktree, 'diffo/pr-7', head)
    expect(existsSync(join(repo, 'hook-ran'))).toBe(false)
    expect(existsSync(join(worktree, 'hook-ran'))).toBe(false)
    expect(git(worktree, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(repo, 'config', 'core.hooksPath')).toBe(hooks)
  })

  it('refuses to overwrite an existing branch when creating a review worktree', () => {
    const { root, repo, base, head } = scenario()
    git(repo, 'branch', 'diffo/pr-7', head)
    expect(() => worktreeAdd(repo, join(root, 'review'), 'diffo/pr-7', base)).toThrow()
    expect(git(repo, 'rev-parse', 'diffo/pr-7')).toBe(head)
    expect(existsSync(join(root, 'review'))).toBe(false)
  })
})
