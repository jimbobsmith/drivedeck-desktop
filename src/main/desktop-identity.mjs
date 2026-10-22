import { app } from 'electron'

// Evaluate before datastore modules compute their paths. Product metadata also
// supplies this name when packaged; no existing FreeTube data is migrated.
app.setName('DD FreeTube')
if (process.platform === 'win32') app.setAppUserModelId('com.drivedeck.freetube')
