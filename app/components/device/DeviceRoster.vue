<script setup lang="ts">
import type { DeviceInfo } from '#shared/types'
import type { DeviceAction, PanelResult, RowPane } from '~/utils/deviceStatus'

const props = defineProps<{
  devices: DeviceInfo[]
  otlpEndpoint: string
  pane: RowPane | null
  busy: boolean
  failure: string | null
}>()

defineEmits<{
  act: [action: DeviceAction, device: DeviceInfo]
  confirm: [result: PanelResult]
  cancel: []
}>()

const { colorFor } = useDeviceColors()

function openOn(device: DeviceInfo): DeviceAction | null {
  return props.pane && props.pane.device.id === device.id ? props.pane.action : null
}

function stamp(value: string | null): string {
  return value ? formatStamp(value) : EM_DASH
}

/** Only a revoked machine has a stop time worth stating next to its state. */
function stoppedAt(device: DeviceInfo): string | null {
  return device.status === 'revoked' ? device.revokedAt : null
}
</script>

<template>
  <div class="roster">
    <div
      class="scroller wide viz-focus"
      tabindex="0"
      role="region"
      aria-label="Machines table, scrolls sideways"
    >
      <table class="table">
        <caption class="sr-only">
          Every machine, its status, the account its token is bound to, the prefix of that token,
          and what it has reported
        </caption>

        <thead>
          <tr>
            <th
              scope="col"
              class="head device-head"
            >
              Machine
            </th>
            <th
              scope="col"
              class="head"
            >
              Status
            </th>
            <th
              scope="col"
              class="head"
            >
              Account
            </th>
            <th
              scope="col"
              class="head"
            >
              Token
            </th>
            <th
              scope="col"
              class="head"
            >
              First seen
            </th>
            <th
              scope="col"
              class="head"
            >
              Last seen
            </th>
            <th
              scope="col"
              class="head amount"
            >
              Sessions
            </th>
            <th
              scope="col"
              class="head"
            >
              Actions
            </th>
          </tr>
        </thead>

        <tbody
          v-for="device in devices"
          :key="device.id"
          :data-status="device.status"
          :data-conflict="device.conflict ? 'yes' : null"
        >
          <tr>
            <th
              scope="row"
              class="cell device-cell"
            >
              <span
                class="swatch"
                :class="{ 'swatch--none': !STATUS[device.status].hasSeries }"
                :style="{ backgroundColor: colorFor(device.id) }"
                aria-hidden="true"
              />
              <span class="viz-mono">{{ device.name }}</span>
            </th>

            <td class="cell">
              <DeviceStatusCell
                :status="device.status"
                :at="stoppedAt(device)"
              />
            </td>

            <td class="cell">
              <DeviceAccountCell :device="device" />
            </td>

            <td class="cell viz-mono">
              {{ device.tokenPrefix }}
            </td>

            <td class="cell viz-mono">
              {{ stamp(device.firstSeen) }}
            </td>

            <td class="cell viz-mono">
              {{ stamp(device.lastSeen) }}
            </td>

            <td class="cell amount viz-mono viz-tabular">
              {{ formatCount(device.sessions) }}
            </td>

            <td class="cell">
              <DeviceActions
                :device="device"
                :open="openOn(device)"
                @act="action => $emit('act', action, device)"
              />
            </td>
          </tr>

          <tr v-if="device.conflict">
            <td
              class="cell inset"
              colspan="8"
            >
              <DeviceConflictBlock
                :device="device"
                :conflict="device.conflict"
                @release="$emit('act', 'release', device)"
              />
            </td>
          </tr>

          <tr v-if="STATUS[device.status].setup">
            <td
              class="cell inset"
              colspan="8"
            >
              <DeviceSetupBlock
                :device="device"
                :otlp-endpoint="otlpEndpoint"
                @rotate="$emit('act', 'rotate', device)"
              />
            </td>
          </tr>

          <tr v-if="pane && pane.device.id === device.id">
            <td
              class="cell inset"
              colspan="8"
            >
              <DevicePanel
                :key="pane.action"
                :pane="pane"
                :busy="busy"
                :failure="failure"
                @confirm="result => $emit('confirm', result)"
                @cancel="$emit('cancel')"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ul class="narrow cards">
      <li
        v-for="device in devices"
        :key="device.id"
        class="card"
        :data-status="device.status"
        :data-conflict="device.conflict ? 'yes' : null"
      >
        <div class="card-head">
          <h3 class="card-name">
            <span
              class="swatch"
              :class="{ 'swatch--none': !STATUS[device.status].hasSeries }"
              :style="{ backgroundColor: colorFor(device.id) }"
              aria-hidden="true"
            />
            <span class="viz-mono">{{ device.name }}</span>
          </h3>

          <DeviceStatusCell
            :status="device.status"
            :at="stoppedAt(device)"
          />
        </div>

        <div class="account-line">
          <p class="viz-eyebrow">
            Account
          </p>
          <DeviceAccountCell :device="device" />
        </div>

        <dl class="facts">
          <div class="fact">
            <dt class="viz-eyebrow">
              Last seen
            </dt>
            <dd class="viz-mono">
              {{ stamp(device.lastSeen) }}
            </dd>
          </div>
          <div class="fact">
            <dt class="viz-eyebrow">
              Sessions
            </dt>
            <dd class="viz-mono viz-tabular">
              {{ formatCount(device.sessions) }}
            </dd>
          </div>
        </dl>

        <details class="details">
          <summary class="summary viz-mono viz-focus">
            Details
          </summary>
          <dl class="facts facts--stacked">
            <div class="fact">
              <dt class="viz-eyebrow">
                Token
              </dt>
              <dd class="viz-mono prefix">
                {{ device.tokenPrefix }}
              </dd>
            </div>
            <div class="fact">
              <dt class="viz-eyebrow">
                First seen
              </dt>
              <dd class="viz-mono">
                {{ stamp(device.firstSeen) }}
              </dd>
            </div>
          </dl>
        </details>

        <DeviceConflictBlock
          v-if="device.conflict"
          :device="device"
          :conflict="device.conflict"
          @release="$emit('act', 'release', device)"
        />

        <DeviceActions
          :device="device"
          :open="openOn(device)"
          @act="action => $emit('act', action, device)"
        />

        <DeviceSetupBlock
          v-if="STATUS[device.status].setup"
          :device="device"
          :otlp-endpoint="otlpEndpoint"
          @rotate="$emit('act', 'rotate', device)"
        />

        <DevicePanel
          v-if="pane && pane.device.id === device.id"
          :key="pane.action"
          :pane="pane"
          :busy="busy"
          :failure="failure"
          @confirm="result => $emit('confirm', result)"
          @cancel="$emit('cancel')"
        />
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* The page must never scroll sideways, so the width lives inside this box. */
.scroller {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}

/* Sizes to its content and stretches only when there is room. A hard 100% would
   squeeze the actions column until every row's buttons stacked. */
.table {
  min-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

/* A wrapping flex row reports one button as its minimum width, so auto table
   layout collapses the column and stacks them. The cards still wrap. */
.wide :deep(.actions) {
  flex-wrap: nowrap;
}

.head {
  padding: 0 14px 8px 0;
  text-align: left;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--viz-ink-secondary);
  border-bottom: 1px solid var(--viz-baseline);
}

.device-head {
  position: sticky;
  left: 0;
  z-index: 1;
  padding-right: 24px;
  background: var(--viz-surface);
}

.cell {
  padding: 11px 14px 11px 0;
  text-align: left;
  vertical-align: top;
  white-space: nowrap;
  color: var(--viz-ink);
  border-bottom: 1px solid var(--viz-grid);
}

.device-cell {
  position: sticky;
  left: 0;
  z-index: 1;
  font-weight: 500;
  padding-right: 24px;
  background: var(--viz-surface);
}

.amount {
  text-align: right;
  padding-right: 14px;
}

.inset {
  white-space: normal;
  padding-left: 12px;
  padding-bottom: 18px;
}

/* Only pending gets a rule, so the rule means "this one needs you". An inset
   shadow rather than a border keeps the sticky column's width unchanged. */
[data-status="pending"] tr > :first-child {
  box-shadow: inset 2px 0 0 var(--viz-status-warning);
}

/* A refused credential is the one thing here the operator must not scroll past,
   so it outranks the pending rule wherever a machine could carry both. */
[data-conflict] tr > :first-child,
[data-conflict].card {
  box-shadow: inset 2px 0 0 var(--viz-status-critical);
}

.account-line {
  display: grid;
  gap: 5px;
}

.swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 9px;
}

.swatch--none {
  visibility: hidden;
}

.cards {
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
  background: var(--viz-grid);
  border-block: 1px solid var(--viz-grid);
}

.card {
  display: grid;
  gap: 14px;
  padding: 18px 16px;
  background: var(--viz-surface);
}

[data-status="pending"].card {
  box-shadow: inset 2px 0 0 var(--viz-status-warning);
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.card-name {
  display: flex;
  align-items: center;
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  overflow-wrap: anywhere;
  color: var(--viz-ink);
}

.facts {
  display: flex;
  gap: 28px;
  margin: 0;
}

.facts--stacked {
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.fact dd {
  margin: 0;
  font-size: 13px;
  color: var(--viz-ink);
}

.prefix {
  overflow-wrap: anywhere;
}

.details {
  border-top: 1px solid var(--viz-grid);
  padding-top: 12px;
}

.summary {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--viz-ink-secondary);
  cursor: pointer;
}
.narrow {
  display: grid;
}

.wide {
  display: none;
}

@media (min-width: 720px) {
  .narrow {
    display: none;
  }

  .wide {
    display: block;
  }
}
</style>
