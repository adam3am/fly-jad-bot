const fs = require('fs')
const yaml = require('js-yaml')
const axios = require('axios')
const env = require('dotenv')

env.config()

const VALID_DAYS = ['senin', 'selasa', 'rabu']
const MONTHS = [
  'januari',
  'februari',
  'maret',
  'april',
  'mei',
  'juni',
  'juli',
  'agustus',
  'september',
  'oktober',
  'november',
  'desember',
]
const HOLIDAY_API_URL = process.env.HOLIDAY_API_URL

async function fetchHolidays() {
  try {
    const response = await axios.get(HOLIDAY_API_URL)
    return response.data.reduce((acc, holiday) => {
      acc[holiday.date] = holiday.name
      return acc
    }, {})
  } catch (error) {
    console.error('Failed to fetch holidays:', error)
    return {}
  }
}

function isHoliday(date, holidays) {
  return date.toISOString().split('T')[0] in holidays
}

function getNextAvailableDate(startDate, holidays, usedDates) {
  const date = new Date(startDate)
  const sixMonthsFromNow = new Date(date)
  sixMonthsFromNow.setMonth(date.getMonth() + 6)

  while (date <= sixMonthsFromNow) {
    const dateString = date.toISOString().split('T')[0]
    if (
      VALID_DAYS.includes(VALID_DAYS[date.getDay() - 1]) &&
      !isHoliday(date, holidays) &&
      !usedDates.has(dateString)
    ) {
      return dateString
    }
    date.setDate(date.getDate() + 1)
  }

  return startDate
}

function formatDate(dateObj) {
  return `${VALID_DAYS[dateObj.getDay() - 1]} ${dateObj.getDate()} ${MONTHS[dateObj.getMonth()]}`
}

function updateProbeDate(probe, newDate, content) {
  const oldDateRegex = new RegExp(
    `(${probe.id}[\\s\\S]*?appointment_date: ")${probe.requests[0].body.appointment_date}`,
    'g'
  )
  return content.replace(oldDateRegex, `$1${newDate}`)
}

function updateAlertMessage(probe, correctDateText, content) {
  const probeRegex = new RegExp(
    `(${probe.id}[\\s\\S]*?message: \\|\\n\\s+\\*).*?(\\*\\s+{{#if)`,
    'g'
  )
  return content.replace(probeRegex, `$1${correctDateText}$2`)
}

async function updateDates(filePath) {
  let content = fs.readFileSync(filePath, 'utf8')
  const data = yaml.load(content)
  let hasChanges = false
  const usedDates = new Set()

  // Get current date and time in WIB (UTC+7)
  const currentDateTime = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })
  )
  const currentHour = currentDateTime.getHours()
  const currentMinutes = currentDateTime.getMinutes()

  // Create a new date object for the starting date
  let startDate = new Date(currentDateTime)

  // If it's past 14:30 WIB, start from tomorrow
  if (currentHour > 14 || (currentHour === 14 && currentMinutes >= 30)) {
    startDate.setDate(startDate.getDate() + 1)
  }

  // Reset time to 00:00:00 for the starting date
  startDate.setHours(0, 0, 0, 0)

  // Ensure startDate is a valid day (Mon, Tue, Wed)
  while (!VALID_DAYS.includes(VALID_DAYS[startDate.getDay() - 1])) {
    startDate.setDate(startDate.getDate() + 1)
  }

  const sixMonthsFromNow = new Date(startDate)
  sixMonthsFromNow.setMonth(startDate.getMonth() + 6)
  const holidays = await fetchHolidays()

  console.log(
    `Current date and time (WIB): ${currentDateTime.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })}`
  )
  console.log(
    `Starting date for appointments (WIB): ${startDate.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }).split(',')[0]}`
  )

  let nextAppointmentDate = new Date(startDate)
  nextAppointmentDate.setDate(nextAppointmentDate.getDate() + 1); // Start from the next day

  // Update all probes
  data.probes.forEach((probe) => {
    if (probe.id.startsWith('jadwal-')) {
      let newDate = getNextAvailableDate(
        nextAppointmentDate.toISOString().split('T')[0],
        holidays,
        usedDates
      )

      // Update the appointment date
      content = updateProbeDate(probe, newDate, content)
      hasChanges = true
      console.log(
        `Updated ${probe.id} from ${probe.requests[0].body.appointment_date} to ${newDate}`
      )

      usedDates.add(newDate)

      if (probe.alerts) {
        const dateObj = new Date(newDate)
        const correctDateText = formatDate(dateObj)
        content = updateAlertMessage(probe, correctDateText, content)
        console.log(
          `Updated alert message for ${probe.id} to "${correctDateText}"`
        )
      }

      // Move to the next day for the next probe
      nextAppointmentDate = new Date(newDate)
      nextAppointmentDate.setDate(nextAppointmentDate.getDate() + 1)
    }
  })

  if (hasChanges) {
    fs.writeFileSync(filePath, content, 'utf8')
    console.log('Changes made to jadwal.yml')
  } else {
    console.log('No changes needed in jadwal.yml')
  }

  return hasChanges
}

updateDates('jadwal.yml')
  .then((hasChanges) => {
    if (hasChanges) {
      console.log('Dates updated successfully')
      process.exit(0)
    } else {
      console.log('No updates were necessary')
      process.exit(1)
    }
  })
  .catch((error) => {
    console.error('Error updating dates:', error)
    process.exit(1)
  })
