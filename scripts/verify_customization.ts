import { config } from '../src/config/config.js'
import { db, prisma } from '../src/utils/database.js'
import { authService } from '../src/services/auth.service.js'
import { settingsController } from '../src/controllers/settings.controller.js'

async function main() {
  console.log('🚀 Starting Verification Script...')

  try {
    await db.connect()

    // 1. Create/Get User
    const email = `test_custom_${Date.now()}@example.com`
    const user = await prisma.user.create({
      data: {
        email,
        password: 'hashed_password', // Mock
        firstName: 'Test',
        lastName: 'User',
        username: `user_${Date.now()}`,
        isActive: true
      }
    })
    console.log(`✅ User created: ${user.email}`)

    // 2. Test updateProfile (via Service directly to save http overhead in script, or use fetch if preferred)
    // We will use service to test logic, but controller wraps it.
    console.log('🔄 Updating Profile with Job Title...')
    const updatedUser = await authService.updateProfile(user.id, {
      jobTitle: 'Gestor de Testes'
    }, '127.0.0.1')
    
    if (updatedUser.jobTitle === 'Gestor de Testes') {
      console.log('✅ Profile updated successfully with Job Title')
    } else {
      console.error('❌ Failed to update job title')
    }

    // 3. Test Settings
    console.log('🔄 Updating Settings...')
    await prisma.setting.upsert({
      where: { key: 'MayorName' },
      update: { value: 'Prefeitura de Teste Script' },
      create: { key: 'MayorName', value: 'Prefeitura de Teste Script', type: 'string', isPublic: true }
    })
    
    const settings = await prisma.setting.findMany({ where: { isPublic: true } })
    const mayorName = settings.find(s => s.key === 'MayorName')
    if (mayorName?.value === 'Prefeitura de Teste Script') {
        console.log('✅ Settings updated and fetched successfully')
    } else {
        console.error('❌ Failed to update/fetch settings')
    }

    // 4. Test Document Metadata
    console.log('🔄 Creating Document with Metadata...')
    const doc = await prisma.communicationDocument.create({
        data: {
            title: 'Doc with Metadata',
            content: '<p>Content</p>',
            documentType: 'OFICIO',
            priority: 'MEDIUM',
            status: 'DRAFT',
            createdBy: user.id,
            metadata: { salutation: 'Ao Magnífico Reitor' }
        }
    })

    if ((doc.metadata as any)?.salutation === 'Ao Magnífico Reitor') {
        console.log('✅ Document created with valid Metadata')
    } else {
        console.error('❌ Failed to save document metadata')
    }

    console.log('🎉 Verification Complete!')

  } catch (error) {
    console.error('❌ Verification Failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

main()
