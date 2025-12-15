/**
 * Tests for constants and type definitions
 *
 * Comprehensive test coverage for constants and validation.
 * Tests cover timeout ranges, poll intervals, script paths, and status values.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  MAX_RESPONSE_LENGTH,
  DEFAULT_TEST_TIMEOUT,
  MAX_TEST_TIMEOUT,
  DEFAULT_INFRA_TIMEOUT,
  MAX_INFRA_TIMEOUT,
  DEFAULT_POLL_INTERVAL,
  MIN_POLL_INTERVAL,
  MAX_POLL_INTERVAL,
  SCRIPTS_DIR,
  TEST_RUN_SCRIPT,
  EMULATOR_START_SCRIPT,
  EMULATOR_STOP_SCRIPT,
  EMULATOR_STATUS_SCRIPT,
  DEV_SERVER_START_SCRIPT,
  DEV_SERVER_STOP_SCRIPT,
  DEV_SERVER_STATUS_SCRIPT,
  CLEANUP_ORPHANS_SCRIPT,
  CLEANUP_WORKTREE_SCRIPT,
  PORT_ALLOCATION_SCRIPT,
  TEST_STATUS_RUNNING,
  TEST_STATUS_PASSED,
  TEST_STATUS_FAILED,
  TEST_STATUS_NOT_STARTED,
  SERVICE_FIREBASE_EMULATORS,
  SERVICE_DEV_SERVER,
  TEMP_DIR,
} from './constants.js';

describe('Response Length Constants', () => {
  it('should define MAX_RESPONSE_LENGTH', () => {
    assert.strictEqual(MAX_RESPONSE_LENGTH, 10000);
    assert.strictEqual(typeof MAX_RESPONSE_LENGTH, 'number');
  });
});

describe('Timeout Constants', () => {
  it('should define test timeout constants', () => {
    assert.strictEqual(DEFAULT_TEST_TIMEOUT, 300);
    assert.strictEqual(MAX_TEST_TIMEOUT, 1800);
  });

  it('should define infrastructure timeout constants', () => {
    assert.strictEqual(DEFAULT_INFRA_TIMEOUT, 120);
    assert.strictEqual(MAX_INFRA_TIMEOUT, 600);
  });

  it('should have default test timeout less than max', () => {
    assert.ok(DEFAULT_TEST_TIMEOUT < MAX_TEST_TIMEOUT);
  });

  it('should have default infra timeout less than max', () => {
    assert.ok(DEFAULT_INFRA_TIMEOUT < MAX_INFRA_TIMEOUT);
  });

  it('should have positive timeout values', () => {
    assert.ok(DEFAULT_TEST_TIMEOUT > 0);
    assert.ok(MAX_TEST_TIMEOUT > 0);
    assert.ok(DEFAULT_INFRA_TIMEOUT > 0);
    assert.ok(MAX_INFRA_TIMEOUT > 0);
  });
});

describe('Poll Interval Constants', () => {
  it('should define poll interval constants', () => {
    assert.strictEqual(DEFAULT_POLL_INTERVAL, 2);
    assert.strictEqual(MIN_POLL_INTERVAL, 1);
    assert.strictEqual(MAX_POLL_INTERVAL, 30);
  });

  it('should have valid poll interval range', () => {
    assert.ok(MIN_POLL_INTERVAL <= DEFAULT_POLL_INTERVAL);
    assert.ok(DEFAULT_POLL_INTERVAL <= MAX_POLL_INTERVAL);
  });

  it('should have positive poll interval values', () => {
    assert.ok(MIN_POLL_INTERVAL > 0);
    assert.ok(DEFAULT_POLL_INTERVAL > 0);
    assert.ok(MAX_POLL_INTERVAL > 0);
  });
});

describe('Script Path Constants', () => {
  it('should define scripts directory', () => {
    assert.strictEqual(SCRIPTS_DIR, 'infrastructure/scripts');
    assert.strictEqual(typeof SCRIPTS_DIR, 'string');
  });

  it('should define test-related scripts', () => {
    assert.strictEqual(TEST_RUN_SCRIPT, 'test-run.sh');
  });

  it('should define emulator-related scripts', () => {
    assert.strictEqual(EMULATOR_START_SCRIPT, 'emulator-start.sh');
    assert.strictEqual(EMULATOR_STOP_SCRIPT, 'emulator-stop.sh');
    assert.strictEqual(EMULATOR_STATUS_SCRIPT, 'emulator-status.sh');
  });

  it('should define dev server-related scripts', () => {
    assert.strictEqual(DEV_SERVER_START_SCRIPT, 'dev-server-start.sh');
    assert.strictEqual(DEV_SERVER_STOP_SCRIPT, 'dev-server-stop.sh');
    assert.strictEqual(DEV_SERVER_STATUS_SCRIPT, 'dev-server-status.sh');
  });

  it('should define cleanup-related scripts', () => {
    assert.strictEqual(CLEANUP_ORPHANS_SCRIPT, 'cleanup-orphans.sh');
    assert.strictEqual(CLEANUP_WORKTREE_SCRIPT, 'cleanup-worktree.sh');
  });

  it('should define port allocation script', () => {
    assert.strictEqual(PORT_ALLOCATION_SCRIPT, 'port-allocation.sh');
  });

  it('should have all script names end with .sh', () => {
    const scripts = [
      TEST_RUN_SCRIPT,
      EMULATOR_START_SCRIPT,
      EMULATOR_STOP_SCRIPT,
      EMULATOR_STATUS_SCRIPT,
      DEV_SERVER_START_SCRIPT,
      DEV_SERVER_STOP_SCRIPT,
      DEV_SERVER_STATUS_SCRIPT,
      CLEANUP_ORPHANS_SCRIPT,
      CLEANUP_WORKTREE_SCRIPT,
      PORT_ALLOCATION_SCRIPT,
    ];

    scripts.forEach((script) => {
      assert.ok(script.endsWith('.sh'), `${script} should end with .sh`);
    });
  });

  it('should have unique script names', () => {
    const scripts = [
      TEST_RUN_SCRIPT,
      EMULATOR_START_SCRIPT,
      EMULATOR_STOP_SCRIPT,
      EMULATOR_STATUS_SCRIPT,
      DEV_SERVER_START_SCRIPT,
      DEV_SERVER_STOP_SCRIPT,
      DEV_SERVER_STATUS_SCRIPT,
      CLEANUP_ORPHANS_SCRIPT,
      CLEANUP_WORKTREE_SCRIPT,
      PORT_ALLOCATION_SCRIPT,
    ];

    const uniqueScripts = new Set(scripts);
    assert.strictEqual(uniqueScripts.size, scripts.length);
  });
});

describe('Test Status Constants', () => {
  it('should define all test status values', () => {
    assert.strictEqual(TEST_STATUS_RUNNING, 'running');
    assert.strictEqual(TEST_STATUS_PASSED, 'passed');
    assert.strictEqual(TEST_STATUS_FAILED, 'failed');
    assert.strictEqual(TEST_STATUS_NOT_STARTED, 'not_started');
  });

  it('should have unique status values', () => {
    const statuses = [
      TEST_STATUS_RUNNING,
      TEST_STATUS_PASSED,
      TEST_STATUS_FAILED,
      TEST_STATUS_NOT_STARTED,
    ];

    const uniqueStatuses = new Set(statuses);
    assert.strictEqual(uniqueStatuses.size, statuses.length);
  });

  it('should use snake_case for status values', () => {
    const statuses = [
      TEST_STATUS_RUNNING,
      TEST_STATUS_PASSED,
      TEST_STATUS_FAILED,
      TEST_STATUS_NOT_STARTED,
    ];

    statuses.forEach((status) => {
      assert.ok(
        status.match(/^[a-z_]+$/),
        `${status} should be snake_case`
      );
    });
  });
});

describe('Service Name Constants', () => {
  it('should define service names', () => {
    assert.strictEqual(SERVICE_FIREBASE_EMULATORS, 'firebase-emulators');
    assert.strictEqual(SERVICE_DEV_SERVER, 'dev-server');
  });

  it('should have unique service names', () => {
    const services = [SERVICE_FIREBASE_EMULATORS, SERVICE_DEV_SERVER];
    const uniqueServices = new Set(services);
    assert.strictEqual(uniqueServices.size, services.length);
  });

  it('should use kebab-case for service names', () => {
    const services = [SERVICE_FIREBASE_EMULATORS, SERVICE_DEV_SERVER];

    services.forEach((service) => {
      assert.ok(
        service.match(/^[a-z-]+$/),
        `${service} should be kebab-case`
      );
    });
  });
});

describe('Temporary Directory Constants', () => {
  it('should define temp directory', () => {
    assert.strictEqual(TEMP_DIR, '.test-mcp');
    assert.strictEqual(typeof TEMP_DIR, 'string');
  });

  it('should start with dot for hidden directory', () => {
    assert.ok(TEMP_DIR.startsWith('.'));
  });
});

describe('Constant Relationships', () => {
  it('should have max test timeout greater than max infra timeout', () => {
    // Tests can run longer than infrastructure operations
    assert.ok(MAX_TEST_TIMEOUT > MAX_INFRA_TIMEOUT);
  });

  it('should have reasonable timeout to poll interval ratios', () => {
    // Ensure we can poll at least a few times within default timeouts
    const minTestPolls = DEFAULT_TEST_TIMEOUT / MAX_POLL_INTERVAL;
    const minInfraPolls = DEFAULT_INFRA_TIMEOUT / MAX_POLL_INTERVAL;

    assert.ok(minTestPolls >= 10, 'Should allow at least 10 polls for tests');
    assert.ok(minInfraPolls >= 4, 'Should allow at least 4 polls for infra');
  });
});
