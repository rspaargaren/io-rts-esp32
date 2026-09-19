import { useState } from "preact/hooks";
import { useRemoteWizard } from "./Modals/remoteWizard.tsx";

export function Remotes(remotesApi) {
  const [droppedDown, setOpen] = useState(true);
  const { open } = useRemoteWizard();

  return (
    <div id="remotes-section" class={droppedDown ? "open" : ""}>
      <div id="remotes-section-hdr">
        <span id="remotes-section-title" data-i18n="section.remotes">
          Remotes
        </span>

        <div className="acc-summary" style={{ gap: 8 }}>
          <span id="remotes-count" />
          <button className="s-btn" onClick={() => open()}>
            + Add
          </button>
        </div>

        <div className="acc-chevron" id="remotes-chevron">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      <div id="remotes-body">
        <div className="remotes-panel">
          <table id="remote-table">
            <thead>
              <tr>
                <th data-i18n="table.remote_id">ID</th>
                <th data-i18n="table.linked_devices">Devices</th>
                <th data-i18n="table.edit">Edit</th>
              </tr>
            </thead>
            {!remotesApi.loaded
              ? "Loading…"
              : remotesApi.data?.map((remote) => (
                  <tr key={remote.id}>
                    <td>{remote.id}</td>
                    <td>{remote.devices.join(", ")}</td>
                    <td>
                      <button className="btn edit bg">Edit</button>
                    </td>
                  </tr>
                ))}
            <tbody />
          </table>
        </div>
      </div>
    </div>
  );
}
