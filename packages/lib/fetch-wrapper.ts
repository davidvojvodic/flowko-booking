import { HttpError } from "./http-error";

// Flowko: the body of an error answer as an object. It is not always JSON (a proxy's HTML 502, an empty 413),
// and JSON null or an array has no fields to read; both count as no body.
async function readErrorBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function http<T>(path: string, config: RequestInit): Promise<T> {
  const request = new Request(path, config);
  const response: Response = await fetch(request);

  if (!response.ok) {
    // Flowko: upstream passed HttpError.fromRequest a spread copy of the Response ({ ...response, statusText }).
    // A Response keeps status and url in getters on its prototype, which a spread does not copy, so every
    // error lost its status (statusCode undefined) and url. A body that was not JSON threw a SyntaxError
    // instead of an HttpError. The message is still the body's `message`, else the status text.
    const errJson = await readErrorBody(response);
    throw new HttpError({
      message:
        typeof errJson.message === "string" && errJson.message ? errJson.message : response.statusText,
      url: response.url || request.url,
      method: request.method,
      statusCode: response.status,
      data: errJson.data as Record<string, unknown> | undefined,
    });
  }
  // may error if there is no body, return empty array
  return await response.json();
}

export async function get<T>(path: string, config?: RequestInit): Promise<T> {
  const init = { method: "GET", ...config };
  return await http<T>(path, init);
}

export async function post<T, U>(path: string, body: T, config?: RequestInit): Promise<U> {
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...config,
  };
  return await http<U>(path, init);
}

export async function put<T, U>(path: string, body: T, config?: RequestInit): Promise<U> {
  const init = {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...config,
  };
  return await http<U>(path, init);
}

export async function patch<T, U>(path: string, body: T, config?: RequestInit): Promise<U> {
  const init = {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...config,
  };
  return await http<U>(path, init);
}

export async function remove<T, U>(path: string, body: T, config?: RequestInit): Promise<U> {
  const init = {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...config,
  };
  return await http<U>(path, init);
}
