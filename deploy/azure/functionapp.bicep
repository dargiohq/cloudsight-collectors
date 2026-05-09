param location string = resourceGroup().location
param cloudSightBaseUrl string
@secure()
param cloudSightApiKey string

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'cloudsightcollector${uniqueString(resourceGroup().id)}'
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'cloudsight-collector-plan'
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  kind: 'functionapp'
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: 'cloudsight-azure-collector'
  location: location
  kind: 'functionapp'
  properties: {
    serverFarmId: plan.id
    siteConfig: {
      appSettings: [
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'CLOUDSIGHT_BASE_URL', value: cloudSightBaseUrl }
        { name: 'CLOUDSIGHT_API_KEY', value: cloudSightApiKey }
        { name: 'COLLECTOR_NAME', value: 'azure-collector' }
        { name: 'COLLECTOR_ENVIRONMENT', value: 'Production' }
      ]
    }
  }
}
