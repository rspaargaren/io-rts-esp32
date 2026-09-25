import { useState } from "preact/hooks";
import { useRemoteWizard } from "./Modals/remoteWizard.tsx";
import { ApiResponse } from "../hooks/useApi";
import { Remote } from "../models/Types";

interface RemotesProps {
  remotesApi: ApiResponse<Remote[]>;
}

export function Remotes({ remotesApi }: RemotesProps) {
  const [droppedDown] = useState(true);
  const { open } = useRemoteWizard();
  const remotes = remotesApi.data ?? [];

  return (
    <div id="remotes-section" class={droppedDown ? "open" : ""}>
      <div id="remotes-section-hdr">
        <span id="remotes-section-title" data-i18n="section.remotes">
          Remotes
        </span>

        <div className="acc-summary" style={{ gap: 8 }}>
          <span id="remotes-count">
            {remotesApi.loaded ? `${remotes.length}` : "…"}
          </span>
          <button type="button" className="s-btn" onClick={() => open()}>
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
            <tbody>
              {!remotesApi.loaded ? (
                <tr>
                  <td colSpan={3}>Loading…</td>
                </tr>
              ) : remotesApi.isError ? (
                <tr>
                  <td colSpan={3}>Failed to load remotes.</td>
                </tr>
              ) : remotes.length === 0 ? (
                <tr>
                  <td colSpan={3}>No remotes available.</td>
                </tr>
              ) : (
                remotes.map((remote) => (
                  <tr key={remote.id}>
                    <td>{remote.id}</td>
                    <td>{remote.devices.join(", ")}</td>
                    <td>
                      <button
                        type="button"
                        className="btn edit bg"
                        onClick={() =>
                          open({
                            mode: "edit",
                            remoteId: remote.id,
                            linkedDevices: remote.devices,
                          })
                        }
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
