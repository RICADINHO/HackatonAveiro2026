export function cameraValues(form: FormData) {
  return Object.fromEntries(['latitude', 'longitude', 'heading'].flatMap((key) => (
    form.has(key) ? [[key, Number(form.get(key))]] : []
  )))
}
